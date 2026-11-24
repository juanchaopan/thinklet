import type { ErrorCode, FieldError } from '@thinklet/contracts';
import type { Toaster } from '../shared/ui/toast';
import { ApiError } from './api';

/** The toast for a failure the parent can only try again later. */
const SOMETHING_WENT_WRONG = '出了点问题，请稍后再试';

/** A 401: the session has already sent the parent to the product home. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated';
}

/**
 * The failure as an ApiError. `Api` throws nothing else, so anything else
 * is a fault of the app itself and is shown as the server failing.
 */
export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'internal');
}

/** The fields the server turned down in a request it found invalid; none for any other failure. */
export function rejectedFields(error: unknown): readonly FieldError[] {
  return error instanceof ApiError && error.code === 'invalid_request' ? error.fields : [];
}

/** Says 出了点问题: the parent can only try again later, and what is on the screen stays. */
export function showSomethingWentWrong(toaster: Toaster): void {
  toaster.show(SOMETHING_WENT_WRONG, 'error', 'wrench');
}

/**
 * Explains a change that failed: nothing for a 401 (the parent is on the
 * way to the product home); for a code in `changedMeanwhile`, which means
 * what the change was about changed meanwhile (rules.md, 同时操作), the toast
 * says why and `reload` reads it again; anything else, a request that got
 * no answer included, is 出了点问题 and leaves the screen as it was.
 * Answers whether the failure was a change made meanwhile, so the caller
 * can tell it from one that left the screen as it was.
 */
export function explainChange(
  error: unknown,
  toaster: Toaster,
  changedMeanwhile: Partial<Record<ErrorCode, string>>,
  reload: () => void,
): boolean {
  if (isSignedOut(error)) {
    return false;
  }
  const { code } = asApiError(error);
  const message = code === 'network' ? undefined : changedMeanwhile[code];
  if (!message) {
    showSomethingWentWrong(toaster);
    return false;
  }
  toaster.show(message, 'error', 'wrench');
  reload();
  return true;
}
