import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  childListSchema,
  familyDetailSchema,
  familyJoinRequestsResponseSchema,
  handledJoinRequestSchema,
  type FamilyDetail,
  type FamilyMember,
  type FieldErrorCode,
  type MeFamily,
  type PendingJoinRequest,
  type UpdateFamilyRequest,
} from '@thinklet/contracts';
import { Api, ApiError } from '../../core/api';
import { CurrentFamily } from '../../core/current-family';
import { asApiError, isSignedOut, rejectedFields } from '../../core/failures';
import {
  explainFailure,
  failureHandling,
  familyPath,
  type FamilyTrouble,
} from '../../core/family-pages';
import { FreshReads } from '../../core/fresh-reads';
import { Session } from '../../core/session';
import type { IconArt } from '../../shared/ui/art';
import { Toaster } from '../../shared/ui/toast';

/**
 * One of the actions the family page runs, the changes and the read of the
 * children before deleting it; only one runs at a time.
 */
export type FamilyAction =
  'name' | 'timezone' | 'code' | 'admin' | 'remove' | 'leave' | 'count' | 'delete';

/** The admin's two answers to a waiting join request, as the api names them. */
export type Decision = 'approve' | 'reject';

/** How saving the name or the time zone ended; a rejected field says why (`code`). */
export type SaveResult =
  | { readonly outcome: 'saved' }
  | { readonly outcome: 'rejected'; readonly code: FieldErrorCode }
  | { readonly outcome: 'failed' };

/** A decided request's row slides out in 250 ms (look.md, 动画, 处理申请), and then leaves the card. */
const SLIDE_AWAY_DURATION = 250;

/** The field the server turned down in a change of the name or the time zone. */
function rejectedField(error: unknown): FieldErrorCode | undefined {
  return rejectedFields(error).at(0)?.code;
}

/**
 * The family to go on to after leaving or deleting `left` (rules.md, 当前
 * 家庭): the next of the parent's families in joining order, or the first
 * after leaving the last; the families come from `remaining`, as they are
 * once the parent has left. Undefined when no family is left.
 */
export function familyAfterLeaving(
  before: readonly MeFamily[],
  remaining: readonly MeFamily[],
  left: string,
): MeFamily | undefined {
  const index = before.findIndex(({ id }) => id === left);
  const order = [...before.slice(index + 1), ...before.slice(0, Math.max(index, 0))];
  const still = remaining.filter(({ id }) => id !== left);
  const next = order.find(({ id }) => still.some((family) => family.id === id));
  return still.find(({ id }) => id === next?.id) ?? still.at(0);
}

/**
 * The family of the family page (`/families/:familyId`) and the changes made
 * there (rules.md, 家庭 and 删除家庭; interfaces.md, 家庭): renaming it and
 * changing its time zone, changing its code, handing the admin role to
 * another member, taking a member out, leaving and deleting it. Each change
 * shows the family as the api answers it, says so in a toast and reads the
 * parent again, so the navigation follows. After leaving or deleting the
 * family, the parent goes on to the library of their next family, or to
 * the start page without one.
 *
 * For the family's admin it also holds the join requests waiting (rules.md,
 * 等你处理（管理员）), read with the family, and approves or rejects them.
 * A decision says nothing: its row slides out of the card, an approved
 * applicant appears among the members at once, and the parent is read
 * again, so the counts in the navigation follow. Each request is decided at
 * most once at a time; the other requests stay open meanwhile.
 *
 * The family and its requests each keep their own freshness: a read shows
 * either only when no newer read of it started and no change to it was
 * shown meanwhile, so a slow read never puts back what a change replaced, a
 * request already decided, or a family the page has moved away from. A
 * decision changes the requests and not the family, so deciding one request
 * never drops the members an earlier approval read.
 *
 * A family the parent is not (or no longer) a member of is `not-found`; a
 * family or a request that changed meanwhile, or a change the rules do not
 * allow, is explained in a toast and read again (rules.md, 同时操作 and
 * 出错时的显示). The page provides its own instance.
 */
@Injectable()
export class FamilyStore {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly currentFamily = inject(CurrentFamily);
  private readonly toaster = inject(Toaster);
  private readonly router = inject(Router);

  private readonly detail = signal<FamilyDetail | null>(null);
  private readonly waiting = signal<readonly PendingJoinRequest[]>([]);
  private readonly trouble = signal<FamilyTrouble | null>(null);
  private readonly running = signal<FamilyAction | null>(null);
  private readonly deciding = signal<ReadonlySet<string>>(new Set());
  private readonly sliding = signal<ReadonlySet<string>>(new Set());
  private readonly familyReads = new FreshReads();
  private readonly requestReads = new FreshReads();
  private familyId = '';

  /** The family as the parent sees it; null until it has been read. */
  readonly family = this.detail.asReadonly();
  /** The join requests waiting for the admin, newest first; none for a member. */
  readonly requests = this.waiting.asReadonly();
  /** Why no family is shown, if it is not. */
  readonly problem = this.trouble.asReadonly();
  /** The action running now. */
  readonly busy = this.running.asReadonly();
  /** The requests being approved or rejected right now. */
  readonly decidingRequests = this.deciding.asReadonly();
  /** Whether the parent is the family's admin, who sees the pencils, the actions and the requests. */
  readonly admin = computed(() => this.detail()?.role === 'admin');

  /** What a failed change does on this page. */
  private readonly failures = failureHandling(
    {
      not_admin: '你已不是管理员',
      not_a_member: '这位家长已经不在家庭里了',
      admin_cannot_leave: '先把管理员设给别人才能离开',
      already_admin: '你已经是管理员了',
      request_closed: '这个申请已经失效了',
      not_found: '这个申请已经不在了',
    },
    { notFound: () => this.notFound(), load: () => this.load() },
  );

  /** Shows the family with the id, read afresh. */
  async open(familyId: string): Promise<void> {
    this.familyId = familyId;
    this.detail.set(null);
    this.waiting.set([]);
    this.sliding.set(new Set());
    this.trouble.set(null);
    await this.load();
  }

  /**
   * Reads the family again, and its waiting requests when the parent is its
   * admin; each is shown while it is still fresh. A failure while nothing is
   * shown yet is kept in `problem`, so the page can say it did not open; a
   * later one keeps the family that is shown.
   */
  async load(): Promise<void> {
    const familyFresh = this.familyReads.start();
    const requestsFresh = this.requestReads.start();
    const familyId = this.familyId;
    try {
      const family = await this.api.get(familyPath(familyId), familyDetailSchema);
      const requests = family.role === 'admin' ? await this.readRequests(familyId) : [];
      if (familyFresh()) {
        this.detail.set(family);
        this.trouble.set(null);
      }
      if (requestsFresh()) {
        this.waiting.set(requests);
        this.sliding.set(new Set());
      }
    } catch (error) {
      if (familyFresh()) {
        this.loadFailed(error);
      }
    }
  }

  /** Saves a new name or time zone; a value the server turns down says which rule it broke. */
  async update(changes: UpdateFamilyRequest): Promise<SaveResult> {
    if (this.running()) {
      return { outcome: 'failed' };
    }
    this.running.set(changes.name === undefined ? 'timezone' : 'name');
    const familyId = this.familyId;
    try {
      const family = await this.api.send(
        'PATCH',
        familyPath(familyId),
        changes,
        familyDetailSchema,
      );
      this.changed(familyId, family, '已保存', 'party');
      return { outcome: 'saved' };
    } catch (error) {
      const code = rejectedField(error);
      if (code) {
        return { outcome: 'rejected', code };
      }
      explainFailure(error, this.toaster, this.failures);
      return { outcome: 'failed' };
    } finally {
      this.running.set(null);
    }
  }

  /** Replaces the family code; the code it replaces stops working at once. */
  changeCode(): Promise<void> {
    return this.run('code', async (familyId) => {
      const family = await this.api.send(
        'POST',
        familyPath(familyId, '/code'),
        undefined,
        familyDetailSchema,
      );
      this.changed(familyId, family, '已更换家庭码', 'key');
    });
  }

  /** Hands the admin role to the member; the parent becomes a member like the others. */
  makeAdmin(member: FamilyMember): Promise<void> {
    return this.run('admin', async (familyId) => {
      const family = await this.api.send(
        'PUT',
        familyPath(familyId, '/admin'),
        { parentId: member.parentId },
        familyDetailSchema,
      );
      this.changed(familyId, family, `「${member.name}」现在是管理员`, 'crown');
    });
  }

  /** Takes the member out of the family. */
  remove(member: FamilyMember): Promise<void> {
    return this.run('remove', async () => {
      await this.api.sendWithoutContent('DELETE', this.memberPath(member.parentId));
      this.toaster.show(`已移出「${member.name}」`, 'success', 'door');
      void this.session.refresh();
      await this.load();
    });
  }

  /** The parent leaves the family, and goes on to the library of the next of their families. */
  leave(): Promise<void> {
    return this.run('leave', async () => {
      const family = this.detail();
      const me = this.session.me();
      if (!family || !me) {
        return;
      }
      await this.api.sendWithoutContent('DELETE', this.memberPath(me.id));
      await this.goOnFrom(family, me.families, `你已离开 ${family.name}`);
    });
  }

  /**
   * How many children the family has now, read afresh for the question
   * that asks before deleting it; undefined when the read failed, which is
   * explained as a failed change is.
   */
  countChildren(): Promise<number | undefined> {
    return this.run(
      'count',
      async (familyId) =>
        (await this.api.get(familyPath(familyId, '/children'), childListSchema)).length,
    );
  }

  /**
   * The admin deletes the family with its children, books, requests and
   * every parent's membership, and goes on to the library of the next of
   * their families.
   */
  deleteFamily(): Promise<void> {
    return this.run('delete', async (familyId) => {
      const family = this.detail();
      const me = this.session.me();
      if (!family || !me) {
        return;
      }
      await this.api.sendWithoutContent('DELETE', familyPath(familyId));
      await this.goOnFrom(family, me.families, `已删除「${family.name}」`);
    });
  }

  /** Whether the request's row is sliding out of the card. */
  isLeaving(requestId: string): boolean {
    return this.sliding().has(requestId);
  }

  /**
   * Approves or rejects the waiting request. The requests read before the
   * decision are stale from then on; an approval reads the family again, so
   * the applicant shows among the members.
   */
  async decide(request: PendingJoinRequest, decision: Decision): Promise<void> {
    if (this.deciding().has(request.id)) {
      return;
    }
    this.deciding.update((ids) => new Set([...ids, request.id]));
    const familyId = this.familyId;
    try {
      await this.api.send(
        'POST',
        familyPath(familyId, `/join-requests/${encodeURIComponent(request.id)}/${decision}`),
        undefined,
        handledJoinRequestSchema,
      );
      if (familyId === this.familyId) {
        this.requestReads.wrote();
        this.slideOut(request.id);
        if (decision === 'approve') {
          void this.readFamilyAgain(familyId);
        }
      }
      void this.session.refresh();
    } catch (error) {
      explainFailure(error, this.toaster, this.failures);
    } finally {
      this.deciding.update((ids) => new Set([...ids].filter((id) => id !== request.id)));
    }
  }

  /**
   * The family's waiting requests. A parent who stopped being the admin
   * between reading the family and its requests has none to see.
   */
  private async readRequests(familyId: string): Promise<readonly PendingJoinRequest[]> {
    try {
      const lists = await this.api.get(
        familyPath(familyId, '/join-requests'),
        familyJoinRequestsResponseSchema,
      );
      return lists.pending;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_admin') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Reads the family alone again, so an applicant just approved shows among
   * the members while the request's row is still sliding out.
   */
  private async readFamilyAgain(familyId: string): Promise<void> {
    const fresh = this.familyReads.start();
    try {
      const family = await this.api.get(familyPath(familyId), familyDetailSchema);
      if (fresh()) {
        this.detail.set(family);
      }
    } catch (error) {
      if (fresh()) {
        this.loadFailed(error);
      }
    }
  }

  /** Slides the request's row out of the card, which it leaves once the slide is over. */
  private slideOut(requestId: string): void {
    this.sliding.update((ids) => new Set([...ids, requestId]));
    setTimeout(() => {
      if (!this.sliding().has(requestId)) {
        return;
      }
      this.sliding.update((ids) => new Set([...ids].filter((id) => id !== requestId)));
      this.waiting.update((requests) => requests.filter(({ id }) => id !== requestId));
    }, SLIDE_AWAY_DURATION);
  }

  /**
   * After leaving or deleting `left`, says so (`text`); the family to go on
   * to becomes the current one and its library opens (rules.md, 当前家庭);
   * without a family left, the start page.
   */
  private async goOnFrom(
    left: FamilyDetail,
    before: readonly MeFamily[],
    text: string,
  ): Promise<void> {
    this.toaster.show(text, 'success', 'door');
    await this.session.refresh();
    const next = familyAfterLeaving(before, this.session.me()?.families ?? [], left.id);
    if (!next) {
      await this.router.navigateByUrl('/start');
      return;
    }
    this.currentFamily.select(next.id);
    await this.router.navigateByUrl('/');
  }

  /**
   * Runs one action on the family shown, which `work` is given the id of,
   * while it is marked busy, and answers what `work` answers. Undefined when
   * another action is running, so this one does not run, or when `work`
   * fails; a failure is explained.
   */
  private async run<T>(
    action: FamilyAction,
    work: (familyId: string) => Promise<T>,
  ): Promise<T | undefined> {
    if (this.running()) {
      return undefined;
    }
    this.running.set(action);
    try {
      return await work(this.familyId);
    } catch (error) {
      explainFailure(error, this.toaster, this.failures);
      return undefined;
    } finally {
      this.running.set(null);
    }
  }

  /**
   * Says a change to the family `familyId` was made, and shows the family as
   * the change left it while the page still shows that family. The change
   * can take the admin role away, so the requests read before it are stale
   * too.
   */
  private changed(familyId: string, family: FamilyDetail, text: string, icon: IconArt): void {
    if (familyId === this.familyId) {
      this.wroteAll();
      this.detail.set(family);
    }
    this.toaster.show(text, 'success', icon);
    void this.session.refresh();
  }

  private loadFailed(error: unknown): void {
    if (isSignedOut(error)) {
      return;
    }
    if (error instanceof ApiError && error.code === 'family_not_found') {
      this.notFound();
    } else if (this.detail() === null) {
      this.trouble.set(asApiError(error));
    }
  }

  /** The parent is not, or no longer, a member: the page says so, and the navigation follows. */
  private notFound(): void {
    this.wroteAll();
    this.detail.set(null);
    this.waiting.set([]);
    this.trouble.set('not-found');
    void this.session.refresh();
  }

  /** Marks both the family and its requests as newer than every read started so far. */
  private wroteAll(): void {
    this.familyReads.wrote();
    this.requestReads.wrote();
  }

  private memberPath(parentId: string): string {
    return familyPath(this.familyId, `/members/${encodeURIComponent(parentId)}`);
  }
}
