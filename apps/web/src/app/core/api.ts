import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { errorResponseSchema, type ErrorCode, type FieldError } from '@thinklet/contracts';
import { Subject, firstValueFrom } from 'rxjs';

/** Anything that checks a response body: the Zod schemas of `@thinklet/contracts`. */
export interface ResponseSchema<T> {
  parse(value: unknown): T;
}

/** `network` stands for a request that got no answer (offline, or the server is unreachable). */
export type ApiErrorCode = ErrorCode | 'network';

/** A request that failed, with the error code the screen picks its message by. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly requestId?: string,
    readonly fields: readonly FieldError[] = [],
  ) {
    super(`The api answered ${String(status)} ${code}`);
    this.name = 'ApiError';
  }
}

type ChangingMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Calls the api. Every response body is checked against its contract schema
 * before anyone uses it, and every failure becomes an ApiError carrying the
 * error code (and the request id, which the screen shows as the error id).
 * A 401 from any call is announced on `unauthenticated` as well.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly signedOut = new Subject<void>();

  /** Emits whenever the api says the parent is not signed in (any 401). */
  readonly unauthenticated = this.signedOut.asObservable();

  get<T>(path: string, schema: ResponseSchema<T>): Promise<T> {
    return this.request('GET', path, undefined, schema);
  }

  send<T>(
    method: ChangingMethod,
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
  ): Promise<T> {
    return this.request(method, path, body, schema);
  }

  /** A request answered with no content (204). */
  async sendWithoutContent(method: ChangingMethod, path: string, body?: unknown): Promise<void> {
    await this.request(method, path, body, undefined);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    schema: ResponseSchema<T> | undefined,
  ): Promise<T> {
    let answer: unknown;
    try {
      answer = await firstValueFrom(this.http.request(method, path, { body }));
    } catch (error) {
      throw this.failure(error);
    }
    if (!schema) {
      return undefined as T;
    }
    try {
      return schema.parse(answer);
    } catch {
      // A body that breaks its contract is a server fault like any other.
      throw new ApiError(200, 'internal');
    }
  }

  private failure(error: unknown): ApiError {
    if (!(error instanceof HttpErrorResponse) || error.status === 0) {
      return new ApiError(0, 'network');
    }
    if (error.status === 401) {
      this.signedOut.next();
    }
    const parsed = errorResponseSchema.safeParse(error.error);
    if (!parsed.success) {
      return new ApiError(error.status, error.status === 401 ? 'unauthenticated' : 'internal');
    }
    const { code, requestId, fields } = parsed.data.error;
    return new ApiError(error.status, code, requestId, fields);
  }
}
