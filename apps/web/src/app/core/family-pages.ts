import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
  type Signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { ErrorCode } from '@thinklet/contracts';
import { PageProblem } from '../shared/ui/page-problem';
import type { Toaster } from '../shared/ui/toast';
import { ApiError } from './api';
import { whenBackInFront } from './connectivity';
import { Session } from './session';

/** The toast for a failure the parent can only try again later. */
const SOMETHING_WENT_WRONG = '出了点问题，请稍后再试';

/**
 * Why a page of one family (its family page, its new members page) shows no
 * family: the parent is not, or no longer, a member, or the server failed or
 * did not answer while the page was opening.
 */
export type FamilyTrouble = 'not-found' | ApiError;

/** What a page of one family reads it with. */
export interface FamilyReader {
  /** Shows the family with the id, read afresh. */
  open(familyId: string): Promise<void>;
  /** Reads the family shown again. */
  load(): Promise<void>;
}

/** The address of one of the family's api routes, `/api/families/<id><suffix>`. */
export function familyPath(familyId: string, suffix = ''): string {
  return `/api/families/${encodeURIComponent(familyId)}${suffix}`;
}

/** A 401: the session has already sent the parent to the product home. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated';
}

/** What a page of one family does about a change that failed. */
export interface FamilyPageActions {
  /** Shows that the parent is not, or no longer, a member. */
  notFound(): void;
  /** Reads the page again. */
  load(): Promise<void>;
}

/** How a page of one family takes a change that failed. */
export interface FailureHandling {
  /**
   * The error codes that mean the family changed meanwhile (rules.md, 同时
   * 操作), with what the toast says; the page is then read again.
   */
  readonly changedMeanwhile: Partial<Record<ErrorCode, string>>;
  /** The parent is not, or no longer, a member: the page says the family is not there. */
  notFound(): void;
  /** Reads the page and the parent again, so both show the family as it is now. */
  reload(): void;
}

/**
 * How a page of one family takes a change that failed, with the codes that
 * mean the family changed meanwhile: reloading reads the page and the
 * parent again. Call it where `inject` works, such as a field initializer.
 */
export function failureHandling(
  changedMeanwhile: Partial<Record<ErrorCode, string>>,
  page: FamilyPageActions,
): FailureHandling {
  const session = inject(Session);
  return {
    changedMeanwhile,
    notFound: () => {
      page.notFound();
    },
    reload: () => {
      void page.load();
      void session.refresh();
    },
  };
}

/**
 * Explains a change that failed on a page of one family: nothing for a 401
 * (the parent is on the way to the product home), 找不到这个家庭 for a family
 * the parent is no longer in, the reason for a family that changed
 * meanwhile, and 出了点问题 for anything else, which leaves the page as it
 * was.
 */
export function explainFailure(error: unknown, toaster: Toaster, handling: FailureHandling): void {
  if (isSignedOut(error)) {
    return;
  }
  const code = error instanceof ApiError ? error.code : 'internal';
  if (code === 'family_not_found') {
    handling.notFound();
    return;
  }
  const message = code === 'network' ? undefined : handling.changedMeanwhile[code];
  toaster.show(message ?? SOMETHING_WENT_WRONG, 'error', 'wrench');
  if (message) {
    handling.reload();
  }
}

/**
 * Keeps a page of one family on the family its address names: the family is
 * read when the page opens and whenever the address names another one, and
 * again whenever the window comes back to the front (rules.md, 通知). Call it
 * where `inject` works, such as a constructor.
 */
export function followFamily(familyId: Signal<string>, reader: FamilyReader): void {
  effect(() => {
    const id = familyId();
    untracked(() => void reader.open(id));
  });
  whenBackInFront(() => void reader.load());
}

/**
 * What a page of one family shows in place of its content when it has no
 * family to show (rules.md, 出错时的显示): 找不到这个家庭 with the way back to
 * the parent's own family (its home page, or the start page without one),
 * or 页面没能打开 with the error number and 重试, which emits `retry`.
 */
@Component({
  selector: 'app-family-trouble',
  imports: [PageProblem],
  template: `
    @if (failure(); as failure) {
      <app-page-problem kind="server" [requestId]="failure.requestId" (action)="retry.emit()" />
    } @else {
      <app-page-problem kind="not-found" (action)="goHome()" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyTroubleView {
  readonly trouble = input.required<FamilyTrouble>();

  readonly retry = output();

  private readonly router = inject(Router);

  protected readonly failure = computed(() => {
    const trouble = this.trouble();
    return trouble instanceof ApiError ? trouble : null;
  });

  protected goHome(): void {
    void this.router.navigateByUrl('/');
  }
}
