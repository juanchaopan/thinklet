import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  familyDetailSchema,
  familyJoinRequestsResponseSchema,
  handledJoinRequestSchema,
  type FamilyDetail,
  type FamilyJoinRequestsResponse,
  type HandledJoinRequest,
  type PendingJoinRequest,
} from '@thinklet/contracts';
import { Api, ApiError } from '../../core/api';
import { asApiError, isSignedOut } from '../../core/failures';
import {
  explainFailure,
  failureHandling,
  familyPath,
  type FamilyTrouble,
} from '../../core/family-pages';
import { FreshReads } from '../../core/fresh-reads';
import { Session } from '../../core/session';
import { Toaster } from '../../shared/ui/toast';

/** The admin's two answers to a waiting request, as the api names them. */
export type Decision = 'approve' | 'reject';

/** Which of the two lists a row is in. */
export type RequestList = 'pending' | 'handled';

/** A handled row slides out in 250 ms (look.md, 动画, 处理申请), and then leaves its list. */
const SLIDE_AWAY_DURATION = 250;

/** The key of a row of one of the lists, as the leaving rows are kept. */
function rowKey(list: RequestList, requestId: string): string {
  return `${list}:${requestId}`;
}

/** The lists without the request, taken off the one named. */
function without(
  lists: FamilyJoinRequestsResponse,
  list: RequestList,
  requestId: string,
): FamilyJoinRequestsResponse {
  const other = (request: { id: string }) => request.id !== requestId;
  return list === 'pending'
    ? { ...lists, pending: lists.pending.filter(other) }
    : { ...lists, handled: lists.handled.filter(other) };
}

/**
 * The family's requests to join on the new members page (rules.md, 新成员
 * (管理员); interfaces.md, 新成员). Approving or rejecting a request moves it
 * to the top of the handled ones at once while its row slides out of the
 * waiting ones; 知道了 slides a handled row out. Neither says anything else:
 * the row's movement is the answer. Each one reads the parent again, so the
 * count on 新成员 follows.
 *
 * A read shows its answer only when no newer read started and no change was
 * shown meanwhile, so a slow read never brings back a request already
 * handled, or the requests of a family the page has moved away from.
 *
 * A request that changed meanwhile is explained in a toast and the lists are
 * read again; a parent who is no longer the admin is told so and goes to
 * the family page; a family the parent is no longer in is `not-found`. The
 * page provides its own instance.
 */
@Injectable()
export class NewMembersStore {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly toaster = inject(Toaster);
  private readonly router = inject(Router);

  private readonly detail = signal<FamilyDetail | null>(null);
  private readonly lists = signal<FamilyJoinRequestsResponse | null>(null);
  private readonly trouble = signal<FamilyTrouble | null>(null);
  private readonly working = signal<ReadonlySet<string>>(new Set());
  private readonly sliding = signal<ReadonlySet<string>>(new Set());
  private readonly reads = new FreshReads();
  private familyId = '';

  /** What a failed change does on this page (interfaces.md, 错误码). */
  private readonly failures = failureHandling(
    { request_closed: '这个申请已经失效了', not_found: '这个申请已经不在了' },
    { notFound: () => this.notFound(), load: () => this.load() },
  );

  /** The family, for its name and the time zone its times are shown in. */
  readonly family = this.detail.asReadonly();
  /** The waiting and the handled requests; null until they have been read. */
  readonly requests = this.lists.asReadonly();
  /** Why the page shows no requests, if it does not. */
  readonly problem = this.trouble.asReadonly();
  /** The requests being handled or cleared right now. */
  readonly busy = this.working.asReadonly();

  /** Shows the requests of the family with the id, read afresh. */
  async open(familyId: string): Promise<void> {
    this.familyId = familyId;
    this.detail.set(null);
    this.lists.set(null);
    this.trouble.set(null);
    await this.load();
  }

  /**
   * Reads the family and its requests again. A failure while nothing is
   * shown yet is kept in `problem`; a later one keeps what is shown.
   */
  async load(): Promise<void> {
    const fresh = this.reads.start();
    const familyId = this.familyId;
    try {
      const [family, lists] = await Promise.all([
        this.api.get(familyPath(familyId), familyDetailSchema),
        this.api.get(familyPath(familyId, '/join-requests'), familyJoinRequestsResponseSchema),
      ]);
      if (fresh()) {
        this.detail.set(family);
        this.lists.set(lists);
        this.sliding.set(new Set());
        this.trouble.set(null);
      }
    } catch (error) {
      if (fresh()) {
        this.loadFailed(error);
      }
    }
  }

  /** Whether the row is sliding out of its list. */
  isLeaving(list: RequestList, requestId: string): boolean {
    return this.sliding().has(rowKey(list, requestId));
  }

  /** Approves or rejects the waiting request. */
  decide(request: PendingJoinRequest, decision: Decision): Promise<void> {
    return this.act(request.id, async (familyId) => {
      const handled = await this.api.send(
        'POST',
        this.requestPath(familyId, request.id, decision),
        undefined,
        handledJoinRequestSchema,
      );
      this.changed(familyId, () => {
        this.lists.update((lists) => lists && { ...lists, handled: [handled, ...lists.handled] });
        this.slideOut('pending', request.id);
      });
    });
  }

  /** The admin's 知道了 on a handled request. */
  dismiss(request: HandledJoinRequest): Promise<void> {
    return this.act(request.id, async (familyId) => {
      await this.api.sendWithoutContent('POST', this.requestPath(familyId, request.id, 'dismiss'));
      this.changed(familyId, () => {
        this.slideOut('handled', request.id);
      });
    });
  }

  /**
   * Shows what a change to the family `familyId` did while the page still
   * shows that family, and reads the parent again, so the count follows.
   */
  private changed(familyId: string, show: () => void): void {
    if (familyId === this.familyId) {
      this.reads.wrote();
      show();
    }
    void this.session.refresh();
  }

  /** Takes a row that has slid out off its list. */
  private gone(list: RequestList, requestId: string): void {
    const key = rowKey(list, requestId);
    if (!this.sliding().has(key)) {
      return;
    }
    this.sliding.update((keys) => new Set([...keys].filter((shown) => shown !== key)));
    this.lists.update((lists) => lists && without(lists, list, requestId));
  }

  /** Slides the row out of its list, which it leaves once the slide is over. */
  private slideOut(list: RequestList, requestId: string): void {
    this.sliding.update((keys) => new Set([...keys, rowKey(list, requestId)]));
    setTimeout(() => {
      this.gone(list, requestId);
    }, SLIDE_AWAY_DURATION);
  }

  /**
   * Runs one action on a request of the family shown, which `action` is
   * given the id of, while it is marked busy; a failure is explained.
   */
  private async act(requestId: string, action: (familyId: string) => Promise<void>): Promise<void> {
    if (this.working().has(requestId)) {
      return;
    }
    this.working.update((ids) => new Set([...ids, requestId]));
    try {
      await action(this.familyId);
    } catch (error) {
      this.explain(error);
    } finally {
      this.working.update((ids) => new Set([...ids].filter((id) => id !== requestId)));
    }
  }

  private loadFailed(error: unknown): void {
    if (isSignedOut(error)) {
      return;
    }
    const failure = asApiError(error);
    if (failure.code === 'family_not_found') {
      this.notFound();
    } else if (failure.code === 'not_admin') {
      void this.toFamilyPage();
    } else if (this.lists() === null) {
      this.trouble.set(failure);
    }
  }

  /** A parent who is no longer the admin is told so and goes to the family page. */
  private explain(error: unknown): void {
    if (error instanceof ApiError && error.code === 'not_admin') {
      this.toaster.show('你已不是管理员', 'error', 'wrench');
      void this.toFamilyPage();
      return;
    }
    explainFailure(error, this.toaster, this.failures);
  }

  /** The parent is not, or no longer, a member: the page says so, and the navigation follows. */
  private notFound(): void {
    this.reads.wrote();
    this.detail.set(null);
    this.lists.set(null);
    this.trouble.set('not-found');
    void this.session.refresh();
  }

  /** The family page, where a parent who is not the admin goes from here. */
  private async toFamilyPage(): Promise<void> {
    await this.session.refresh();
    await this.router.navigateByUrl(`/families/${this.familyId}`, { replaceUrl: true });
  }

  private requestPath(familyId: string, requestId: string, action: Decision | 'dismiss'): string {
    return familyPath(familyId, `/join-requests/${encodeURIComponent(requestId)}/${action}`);
  }
}
