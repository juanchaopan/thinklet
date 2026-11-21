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
import { ApiError } from './api-error.js';

/** The status, error code and rejected fields an error is answered with. */
export interface ErrorOutcome {
  status: number;
  code: ErrorCode;
  fields?: FieldError[];
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
 * How an error is answered. The api's own errors keep their code; a missing
 * route is `not_found`; any other client error (a body that is not JSON, one
 * that is too large) is `invalid_request` with its status; everything else
 * is a 500 `internal`.
 */
export function errorOutcome(error: unknown): ErrorOutcome {
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
 * `{ error: { code, requestId, fields? } }`. Unexpected errors are logged
 * with their safe description and answered without any detail.
 */
@Catch()
export class ErrorResponseFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorResponseFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, code, fields } = errorOutcome(exception);
    if (code === 'internal') {
      this.logger.error({ error: describeError(exception) }, 'Unexpected error');
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    const body: ErrorResponse = {
      error: { code, requestId: requestIdOf(request, response), ...(fields && { fields }) },
    };
    response.status(status).json(body);
  }
}
