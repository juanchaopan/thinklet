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
import { Api, type ApiError } from './api';
import { asApiError, explainChange, isSignedOut } from './failures';
import { Session } from './session';

/** What the toast says when the request a change was about is gone. */
const REQUEST_GONE: Partial<Record<ErrorCode, string>> = { not_found: '这个申请已经不在了' };

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
        this.problem.set(asApiError(error));
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
   * the list when the action is done. A request that is gone, or a code in
   * `changed`, means the request changed meanwhile: the toast says so and
   * the list and the parent are read again.
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
      explainChange(error, this.toaster, { ...changed, ...REQUEST_GONE }, () => {
        void this.load();
        void this.session.refresh();
      });
    } finally {
      this.working.update((ids) => new Set([...ids].filter((id) => id !== request.id)));
    }
  }
}
