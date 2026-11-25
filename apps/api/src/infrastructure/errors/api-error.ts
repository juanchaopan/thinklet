import { HttpException, HttpStatus } from '@nestjs/common';
import type { AdminFamily, ErrorCode, FieldError } from '@thinklet/contracts';

/**
 * An error the api answers with its own status and error code
 * (`.docs/design/interfaces.md`, "通用约定"); `fields` names the rejected
 * fields of an `invalid_request`.
 */
export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    readonly fields?: FieldError[],
  ) {
    super(code, status);
  }
}

/**
 * 429 `rate_limited`: the request's source has failed too often in a
 * window, and `retryAfterSeconds` are left of it; the answer carries them
 * in its body and in its `Retry-After` header.
 */
export class RateLimitedError extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super('rate_limited', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * 409 `still_admin`: the parent cannot delete their account while they are
 * the admin of a family; the answer names those families.
 */
export class StillAdminError extends ApiError {
  constructor(readonly families: AdminFamily[]) {
    super('still_admin', HttpStatus.CONFLICT);
  }
}
