import { Injectable, inject, signal } from '@angular/core';
import {
  applicantJoinRequestListSchema,
  applicantJoinRequestSchema,
  familyCodeLookupResponseSchema,
  type ApplicantJoinRequest,
  type ErrorCode,
  type FamilyCodeLookupResponse,
} from '@thinklet/contracts';
import { Toaster } from '../shared/ui/toast';
import { Api, ApiError } from './api';
import { Session } from './session';

/** The toast for a failure the parent can only try again later. */
const SOMETHING_WENT_WRONG = '出了点问题，请稍后再试';

/**
 * The signed-in parent's own requests to join families (rules.md, 我的申请),
 * which the start page and the join page both list, and the calls that look
 * up a family code and send, withdraw or dismiss a request.
 *
 * Withdrawing and dismissing take the request off the list at once, without
 * a toast; dismissing also reads the parent again, so the red dot follows. A
 * request that changed meanwhile is explained in a toast and the list is
 * read again (rules.md, 同时操作).
 */
@Injectable({ providedIn: 'root' })
export class JoinRequests {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly toaster = inject(Toaster);

  private readonly list = signal<readonly ApplicantJoinRequest[] | null>(null);
  private readonly problem = signal<ApiError | null>(null);
  private readonly working = signal<ReadonlySet<string>>(new Set());

  /** The requests, newest first; null until they have been read once. */
  readonly requests = this.list.asReadonly();
  /** Why the requests could not be read when there was nothing to show yet. */
  readonly failure = this.problem.asReadonly();
  /** The requests being withdrawn or dismissed right now. */
  readonly busy = this.working.asReadonly();

  /**
   * Reads the requests again. A failure while nothing has been shown yet is
   * kept in `failure`, so the page can say it did not open; a later failure
   * keeps the list that is shown.
   */
  async load(): Promise<void> {
    try {
      this.list.set(await this.api.get('/api/join-requests', applicantJoinRequestListSchema));
      this.problem.set(null);
    } catch (error) {
      if (this.list() === null && !isSignedOut(error)) {
        this.problem.set(error instanceof ApiError ? error : new ApiError(0, 'internal'));
      }
    }
  }

  /** The family a code belongs to and its admin; the code is in capitals already. */
  lookUp(code: string): Promise<FamilyCodeLookupResponse> {
    return this.api.get(
      `/api/family-codes/${encodeURIComponent(code)}`,
      familyCodeLookupResponseSchema,
    );
  }

  /** Sends a request with the code; it goes to the top of the list. */
  async send(code: string): Promise<void> {
    const request = await this.api.send(
      'POST',
      '/api/join-requests',
      { code },
      applicantJoinRequestSchema,
    );
    this.list.update((requests) => [request, ...(requests ?? [])]);
  }

  async withdraw(request: ApplicantJoinRequest): Promise<void> {
    await this.act(
      request,
      async () => {
        await this.api.sendWithoutContent('DELETE', `/api/join-requests/${request.id}`);
      },
      { request_closed: '这个申请已经处理过了' },
    );
  }

  async dismiss(request: ApplicantJoinRequest): Promise<void> {
    await this.act(request, async () => {
      await this.api.sendWithoutContent('POST', `/api/join-requests/${request.id}/dismiss`);
      void this.session.refresh();
    });
  }

  /**
   * Runs one action on a request while it is marked busy, and takes it off
   * the list when the action is done. `changed` names the error codes that
   * mean the request changed meanwhile, with what to tell the parent.
   */
  private async act(
    request: ApplicantJoinRequest,
    action: () => Promise<void>,
    changed: Partial<Record<ErrorCode, string>> = {},
  ): Promise<void> {
    this.working.update((ids) => new Set([...ids, request.id]));
    try {
      await action();
      this.list.update((requests) => (requests ?? []).filter((shown) => shown.id !== request.id));
    } catch (error) {
      this.explain(error, changed);
    } finally {
      this.working.update((ids) => new Set([...ids].filter((id) => id !== request.id)));
    }
  }

  private explain(error: unknown, changed: Partial<Record<ErrorCode, string>>): void {
    if (isSignedOut(error)) {
      return;
    }
    const code = error instanceof ApiError ? error.code : 'internal';
    const message =
      code === 'not_found' ? '这个申请已经不在了' : code === 'network' ? undefined : changed[code];
    if (!message) {
      this.toaster.show(SOMETHING_WENT_WRONG, 'error', 'wrench');
      return;
    }
    this.toaster.show(message, 'error', 'wrench');
    void this.load();
    void this.session.refresh();
  }
}

/** A 401: the session has already sent the parent to the product home. */
function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated';
}
