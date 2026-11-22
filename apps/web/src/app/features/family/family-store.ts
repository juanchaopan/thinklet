import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  familyDetailSchema,
  type FamilyDetail,
  type FamilyMember,
  type FieldErrorCode,
  type MeFamily,
  type UpdateFamilyRequest,
} from '@thinklet/contracts';
import { Api, ApiError } from '../../core/api';
import { CurrentFamily, pageAfterSwitch } from '../../core/current-family';
import {
  explainFailure,
  failureHandling,
  familyPath,
  isSignedOut,
  type FamilyTrouble,
} from '../../core/family-pages';
import { Session } from '../../core/session';
import type { IconArt } from '../../shared/ui/art';
import { Toaster } from '../../shared/ui/toast';

/** One of the changes the family page makes; only one runs at a time. */
export type FamilyAction = 'name' | 'timezone' | 'code' | 'admin' | 'remove' | 'leave';

/** How saving the name or the time zone ended; a rejected field says why (`code`). */
export type SaveResult =
  | { readonly outcome: 'saved' }
  | { readonly outcome: 'rejected'; readonly code: FieldErrorCode }
  | { readonly outcome: 'failed' };

/** The field the server turned down in a change of the name or the time zone. */
function rejectedField(error: unknown): FieldErrorCode | undefined {
  return error instanceof ApiError && error.code === 'invalid_request'
    ? error.fields.at(0)?.code
    : undefined;
}

/**
 * The family to go on to after leaving `left` (rules.md, 当前家庭): the next
 * of the parent's families in joining order, or the first after leaving the
 * last; the families come from `remaining`, as they are once the parent has
 * left. Undefined when no family is left.
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
 * there (rules.md, 家庭; interfaces.md, 家庭): renaming it and changing its
 * time zone, changing its code, handing the admin role to another member,
 * taking a member out, and leaving. Each change shows the family as the api
 * answers it, says so in a toast and reads the parent again, so the
 * navigation follows.
 *
 * A family the parent is not (or no longer) a member of is `not-found`; a
 * family that changed meanwhile is explained in a toast and read again
 * (rules.md, 同时操作). The page provides its own instance.
 */
@Injectable()
export class FamilyStore {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly currentFamily = inject(CurrentFamily);
  private readonly toaster = inject(Toaster);
  private readonly router = inject(Router);

  private readonly detail = signal<FamilyDetail | null>(null);
  private readonly trouble = signal<FamilyTrouble | null>(null);
  private readonly running = signal<FamilyAction | null>(null);
  private familyId = '';

  /** The family as the parent sees it; null until it has been read. */
  readonly family = this.detail.asReadonly();
  /** Why no family is shown, if it is not. */
  readonly problem = this.trouble.asReadonly();
  /** The change running now. */
  readonly busy = this.running.asReadonly();
  /** Whether the parent is the family's admin, who sees the pencils and the actions. */
  readonly admin = computed(() => this.detail()?.role === 'admin');

  /** What a failed change does on this page. */
  private readonly failures = failureHandling(
    {
      not_admin: '你已不是管理员',
      not_a_member: '这位家长已经不在家庭里了',
      admin_cannot_leave: '先把管理员设给别人才能离开',
    },
    { notFound: () => this.notFound(), load: () => this.load() },
  );

  /** Shows the family with the id, read afresh. */
  async open(familyId: string): Promise<void> {
    this.familyId = familyId;
    this.detail.set(null);
    this.trouble.set(null);
    await this.load();
  }

  /**
   * Reads the family again. A failure while nothing is shown yet is kept in
   * `problem`, so the page can say it did not open; a later one keeps the
   * family that is shown.
   */
  async load(): Promise<void> {
    const familyId = this.familyId;
    try {
      const family = await this.api.get(familyPath(familyId), familyDetailSchema);
      if (familyId === this.familyId) {
        this.detail.set(family);
        this.trouble.set(null);
      }
    } catch (error) {
      if (familyId === this.familyId) {
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
    try {
      const family = await this.api.send(
        'PATCH',
        familyPath(this.familyId),
        changes,
        familyDetailSchema,
      );
      this.changed(family, '已保存', 'party');
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

  /** Replaces the family code; the old one stops working at once. */
  changeCode(): Promise<void> {
    return this.run('code', async () => {
      const family = await this.api.send(
        'POST',
        familyPath(this.familyId, '/code'),
        undefined,
        familyDetailSchema,
      );
      this.changed(family, '已更换家庭码', 'key');
    });
  }

  /** Hands the admin role to the member; the parent becomes a member like the others. */
  makeAdmin(member: FamilyMember): Promise<void> {
    return this.run('admin', async () => {
      const family = await this.api.send(
        'PUT',
        familyPath(this.familyId, '/admin'),
        { parentId: member.parentId },
        familyDetailSchema,
      );
      this.changed(family, `「${member.name}」现在是管理员`, 'crown');
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

  /** The parent leaves the family, and goes on to the next of their families. */
  leave(): Promise<void> {
    return this.run('leave', async () => {
      const family = this.detail();
      const me = this.session.me();
      if (!family || !me) {
        return;
      }
      await this.api.sendWithoutContent('DELETE', this.memberPath(me.id));
      await this.goOnFrom(family, me.families);
    });
  }

  /**
   * After leaving `left`, the family to go on to becomes the current one and
   * the page the rules give for switching to it opens (rules.md, 导航);
   * without a family left, the start page.
   */
  private async goOnFrom(left: FamilyDetail, before: readonly MeFamily[]): Promise<void> {
    this.toaster.show(`你已离开 ${left.name}`, 'success', 'door');
    await this.session.refresh();
    const next = familyAfterLeaving(before, this.session.me()?.families ?? [], left.id);
    if (!next) {
      await this.router.navigateByUrl('/start');
      return;
    }
    this.currentFamily.select(next.id);
    await this.router.navigateByUrl(pageAfterSwitch(this.router.url, next) ?? '/');
  }

  /** Runs one change while it is marked busy; a failure is explained. */
  private async run(action: FamilyAction, work: () => Promise<void>): Promise<void> {
    if (this.running()) {
      return;
    }
    this.running.set(action);
    try {
      await work();
    } catch (error) {
      explainFailure(error, this.toaster, this.failures);
    } finally {
      this.running.set(null);
    }
  }

  private changed(family: FamilyDetail, text: string, icon: IconArt): void {
    this.detail.set(family);
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
      this.trouble.set(error instanceof ApiError ? error : new ApiError(0, 'internal'));
    }
  }

  /** The parent is not, or no longer, a member: the page says so, and the navigation follows. */
  private notFound(): void {
    this.detail.set(null);
    this.trouble.set('not-found');
    void this.session.refresh();
  }

  private memberPath(parentId: string): string {
    return familyPath(this.familyId, `/members/${encodeURIComponent(parentId)}`);
  }
}
