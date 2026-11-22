import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ErrorCode, FieldError } from '@thinklet/contracts';

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
