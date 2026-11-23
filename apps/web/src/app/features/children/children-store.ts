import { Injectable, inject, signal } from '@angular/core';
import {
  childDeviceListSchema,
  childListSchema,
  childLoginLinkSchema,
  childLoginLinkStatusResponseSchema,
  childSchema,
  familyDetailSchema,
  type AddChildRequest,
  type Child,
  type ChildDevice,
  type ChildLoginLink,
  type ChildLoginLinkStatus,
  type FamilyDetail,
  type FieldError,
  type UpdateChildRequest,
} from '@thinklet/contracts';
import { Api, ApiError } from '../../core/api';
import { asApiError, rejectedFields } from '../../core/failures';
import {
  explainFailure,
  failureHandling,
  familyPath,
  readTrouble,
  type FamilyTrouble,
} from '../../core/family-pages';
import { FreshReads } from '../../core/fresh-reads';
import { Session } from '../../core/session';
import { Toaster } from '../../shared/ui/toast';

/** One of the changes to a child that are saved or confirmed; only one runs at a time. */
export type ChildAction = 'save' | 'reset' | 'delete' | 'revoke-all';

/**
 * How a change ended: `done`; `failed`, said in a toast, with what is on the
 * screen left as it was; or `gone`, the child (or the family) is no longer
 * there, which has been said and the page read again, so whatever was open
 * for the child closes.
 */
export type ChangeOutcome = 'done' | 'failed' | 'gone';

/** A field of the child form the server turned down, and why; `taken` is an account another child has. */
export interface RejectedField {
  readonly path: string;
  readonly code: FieldError['code'] | 'taken';
}

/** How adding or saving a child ended: as any change, or `rejected` with the fields turned down. */
export type SaveOutcome =
  | { readonly outcome: ChangeOutcome }
  | { readonly outcome: 'rejected'; readonly fields: readonly RejectedField[] };

/**
 * What a check of a login link found: its status; `invalid` for a link or
 * a child that is no longer there, which the QR code shows as 已失效 like an
 * expired one; or `unknown` when the check failed and is simply tried again.
 */
export type LinkCheck = ChildLoginLinkStatus | 'invalid' | 'unknown';

/** What the page shows: the family and its children, or why there are none. */
interface Shown {
  readonly family: FamilyDetail | null;
  readonly children: readonly Child[] | null;
  readonly trouble: FamilyTrouble | null;
}

const NOTHING_SHOWN: Shown = { family: null, children: null, trouble: null };

/**
 * The children of the children page (`/families/:familyId/children`) and
 * what the family's parents do for them (rules.md, 孩子; interfaces.md, 孩子
 * （家长）): adding a child with the guardian's consent, changing the
 * nickname and the account, resetting the password, deleting, making a login
 * link for the QR code and checking whether it was used, and looking after
 * the devices the child is remembered on. The family is read with the
 * children for its name and the time zone dates are shown in.
 *
 * A read shows its answer only when no newer read started and no change was
 * shown meanwhile, so a slow read never puts back a child just deleted, or
 * the children of a family the page has moved away from.
 *
 * A child deleted meanwhile is said in a toast (这个孩子已经被删除了) and the
 * children are read again (rules.md, 同时操作); a family the parent is not
 * (or no longer) a member of is `not-found`. The page provides its own
 * instance.
 */
@Injectable()
export class ChildrenStore {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly toaster = inject(Toaster);

  private readonly shown = signal<Shown>(NOTHING_SHOWN);
  private readonly running = signal<ChildAction | null>(null);
  private readonly reads = new FreshReads();
  private familyId = '';

  /** What a failed change does on this page (interfaces.md, 错误码). */
  private readonly failures = failureHandling(
    { child_not_found: '这个孩子已经被删除了' },
    { notFound: () => this.notFound(), load: () => this.load() },
  );

  /** The change running now. */
  readonly busy = this.running.asReadonly();

  /** The family, for its name and the time zone its dates are shown in. */
  family(): FamilyDetail | null {
    return this.shown().family;
  }

  /** The family's children in the order they were added; null until they have been read. */
  children(): readonly Child[] | null {
    return this.shown().children;
  }

  /** Why the page shows no children, if it does not. */
  problem(): FamilyTrouble | null {
    return this.shown().trouble;
  }

  /** Shows the children of the family with the id, read afresh. */
  async open(familyId: string): Promise<void> {
    this.familyId = familyId;
    this.shown.set(NOTHING_SHOWN);
    await this.load();
  }

  /**
   * Reads the family and its children again. A family the parent is not in
   * says so; another failure while nothing is shown yet is kept in
   * `problem`, and a later one keeps what is shown.
   */
  async load(): Promise<void> {
    const fresh = this.reads.start();
    const familyId = this.familyId;
    try {
      const [family, children] = await Promise.all([
        this.api.get(familyPath(familyId), familyDetailSchema),
        this.api.get(familyPath(familyId, '/children'), childListSchema),
      ]);
      if (fresh()) {
        this.shown.set({ family, children, trouble: null });
      }
    } catch (error) {
      const trouble = readTrouble(error);
      if (!fresh() || trouble === null) {
        return;
      }
      if (trouble === 'not-found') {
        this.notFound();
      } else if (this.children() === null) {
        this.shown.set({ ...NOTHING_SHOWN, trouble });
      }
    }
  }

  /** Adds a child with the guardian's consent; the child joins the end of the list. */
  add(request: AddChildRequest): Promise<SaveOutcome> {
    return this.save(async (familyId) => {
      const child = await this.api.send(
        'POST',
        familyPath(familyId, '/children'),
        request,
        childSchema,
      );
      this.changed(familyId, (children) => [...children, child]);
      this.toaster.show(`已添加「${child.nickname}」`, 'success', 'child');
    });
  }

  /** Saves a new nickname and account for the child. */
  update(child: Child, request: UpdateChildRequest): Promise<SaveOutcome> {
    return this.save(async (familyId) => {
      const saved = await this.api.send(
        'PATCH',
        this.childPath(familyId, child.id),
        request,
        childSchema,
      );
      this.changed(familyId, (children) =>
        children.map((shown) => (shown.id === saved.id ? saved : shown)),
      );
      this.toaster.show('已保存', 'success', 'party');
    });
  }

  /** Deletes the child with everything kept for them. */
  remove(child: Child): Promise<ChangeOutcome> {
    return this.run('delete', async (familyId) => {
      await this.api.sendWithoutContent('DELETE', this.childPath(familyId, child.id));
      this.changed(familyId, (children) => children.filter((shown) => shown.id !== child.id));
      this.toaster.show(`已删除「${child.nickname}」`, 'success', 'door');
    });
  }

  /** Clears the child's password and the devices the child is remembered on. */
  resetPassword(child: Child): Promise<ChangeOutcome> {
    return this.run('reset', async (familyId) => {
      await this.api.sendWithoutContent(
        'POST',
        this.childPath(familyId, child.id, '/password-reset'),
      );
      this.toaster.show(`已重设「${child.nickname}」的密码`, 'success', 'key');
    });
  }

  /** Revokes every device the child is remembered on. */
  revokeAllDevices(child: Child): Promise<ChangeOutcome> {
    return this.run('revoke-all', async (familyId) => {
      await this.api.sendWithoutContent('DELETE', this.childPath(familyId, child.id, '/devices'));
      this.toaster.show('已全部撤销', 'success', 'hourglass');
    });
  }

  /**
   * Revokes one device without a word: the row's movement is the answer. A
   * device revoked already is gone all the same.
   */
  async revokeDevice(child: Child, device: ChildDevice): Promise<ChangeOutcome> {
    try {
      await this.api.sendWithoutContent(
        'DELETE',
        this.childPath(this.familyId, child.id, `/devices/${encodeURIComponent(device.id)}`),
      );
      return 'done';
    } catch (error) {
      return this.failed(error);
    }
  }

  /**
   * The devices the child is remembered on, latest login first; `failed`
   * or `gone` when they could not be read, which has been said.
   */
  async devices(child: Child): Promise<readonly ChildDevice[] | Exclude<ChangeOutcome, 'done'>> {
    try {
      return await this.api.get(
        this.childPath(this.familyId, child.id, '/devices'),
        childDeviceListSchema,
      );
    } catch (error) {
      return this.failed(error);
    }
  }

  /**
   * Makes a new login link for the child, which revokes the links not used
   * yet; `failed` or `gone` when it could not be made, which has been said.
   */
  async createLink(child: Child): Promise<ChildLoginLink | Exclude<ChangeOutcome, 'done'>> {
    try {
      return await this.api.send(
        'POST',
        this.childPath(this.familyId, child.id, '/login-links'),
        undefined,
        childLoginLinkSchema,
      );
    } catch (error) {
      return this.failed(error);
    }
  }

  /** Checks whether the login link has been used, has run out or was revoked. */
  async checkLink(child: Child, link: ChildLoginLink): Promise<LinkCheck> {
    try {
      const { status } = await this.api.get(
        this.childPath(this.familyId, child.id, `/login-links/${encodeURIComponent(link.id)}`),
        childLoginLinkStatusResponseSchema,
      );
      return status;
    } catch (error) {
      const { code } = asApiError(error);
      return code === 'child_not_found' || code === 'not_found' ? 'invalid' : 'unknown';
    }
  }

  /**
   * Runs the adding or saving of a child while it is marked busy. Fields the
   * server turns down, an account another child has included, are given
   * back to the form; other failures are explained.
   */
  private save(work: (familyId: string) => Promise<void>): Promise<SaveOutcome> {
    return this.whileBusy<SaveOutcome>('save', { outcome: 'failed' }, async () => {
      try {
        await work(this.familyId);
        return { outcome: 'done' };
      } catch (error) {
        if (error instanceof ApiError && error.code === 'account_taken') {
          return { outcome: 'rejected', fields: [{ path: 'account', code: 'taken' }] };
        }
        const fields = rejectedFields(error);
        return fields.length > 0
          ? { outcome: 'rejected', fields }
          : { outcome: this.failed(error) };
      }
    });
  }

  /** Runs one confirmed change to a child while it is marked busy; a failure is explained. */
  private run(
    action: ChildAction,
    work: (familyId: string) => Promise<void>,
  ): Promise<ChangeOutcome> {
    return this.whileBusy<ChangeOutcome>(action, 'failed', async () => {
      try {
        await work(this.familyId);
        return 'done';
      } catch (error) {
        return this.failed(error);
      }
    });
  }

  /**
   * Runs the work with `action` marked busy. Only one change runs at a time:
   * while another runs, nothing is done and the answer is `refused`.
   */
  private async whileBusy<T>(action: ChildAction, refused: T, work: () => Promise<T>): Promise<T> {
    if (this.running()) {
      return refused;
    }
    this.running.set(action);
    try {
      return await work();
    } finally {
      this.running.set(null);
    }
  }

  /** Explains a failed change and says whether the child (or the family) has gone. */
  private failed(error: unknown): Exclude<ChangeOutcome, 'done'> {
    explainFailure(error, this.toaster, this.failures);
    const { code } = asApiError(error);
    return code === 'child_not_found' || code === 'family_not_found' ? 'gone' : 'failed';
  }

  /**
   * Shows the children as a change to the family `familyId` left them while
   * the page still shows that family.
   */
  private changed(
    familyId: string,
    update: (children: readonly Child[]) => readonly Child[],
  ): void {
    if (familyId === this.familyId) {
      this.reads.wrote();
      this.shown.update((shown) => ({
        ...shown,
        children: shown.children && update(shown.children),
      }));
    }
  }

  /** The parent is not, or no longer, a member: the page says so, and the navigation follows. */
  private notFound(): void {
    this.reads.wrote();
    this.shown.set({ ...NOTHING_SHOWN, trouble: 'not-found' });
    void this.session.refresh();
  }

  private childPath(familyId: string, childId: string, suffix = ''): string {
    return familyPath(familyId, `/children/${encodeURIComponent(childId)}${suffix}`);
  }
}
