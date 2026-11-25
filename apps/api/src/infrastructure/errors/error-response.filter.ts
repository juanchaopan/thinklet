import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ErrorCode, ErrorResponse, FieldError } from '@thinklet/contracts';
import type { Request, Response } from 'express';
import { describeError } from '../logging/describe-error.js';
import { requestIdOf } from '../logging/request-id.js';
import { ApiError, RateLimitedError } from './api-error.js';

/** The status, error code, rejected fields and waiting time an error is answered with. */
export interface ErrorOutcome {
  status: number;
  code: ErrorCode;
  fields?: FieldError[];
  retryAfterSeconds?: number;
}

const INTERNAL: ErrorOutcome = { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'internal' };

/**
 * The HTTP status an error carries: Nest's own exceptions, and the client
 * errors of Express middleware such as body-parser (a too large body, an
 * unsupported charset), which mark them with `status` and `expose`.
 */
function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) {
    return error.getStatus();
  }
  if (typeof error === 'object' && error !== null) {
    const { status, expose } = error as { status?: unknown; expose?: unknown };
    if (expose === true && typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

/**
 * How an error is answered. The api's own errors keep their code, with the
 * rejected fields of an `invalid_request` and the seconds left of a
 * `rate_limited`; a missing route is `not_found`; any other client error (a
 * body that is not JSON, one that is too large) is `invalid_request` with
 * its status; everything else is a 500 `internal`.
 */
export function errorOutcome(error: unknown): ErrorOutcome {
  if (error instanceof RateLimitedError) {
    return {
      status: error.getStatus(),
      code: error.code,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof ApiError) {
    const outcome: ErrorOutcome = { status: error.getStatus(), code: error.code };
    return error.fields ? { ...outcome, fields: error.fields } : outcome;
  }
  const status = statusOf(error);
  if (status === undefined || status < 400 || status >= 500) {
    return INTERNAL;
  }
  return { status, code: status === 404 ? 'not_found' : 'invalid_request' };
}

/**
 * Global filter that answers every error with the common error body,
 * `{ error: { code, requestId, fields?, retryAfterSeconds? } }`, and a
 * `rate_limited` with a `Retry-After` header as well. Unexpected errors are
 * logged with their safe description and answered without any detail.
 */
@Catch()
export class ErrorResponseFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorResponseFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, code, fields, retryAfterSeconds } = errorOutcome(exception);
    if (code === 'internal') {
      this.logger.error({ error: describeError(exception) }, 'Unexpected error');
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    if (retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
    }
    const body: ErrorResponse = {
      error: {
        code,
        requestId: requestIdOf(request, response),
        ...(fields && { fields }),
        ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      },
    };
    response.status(status).json(body);
  }
}
