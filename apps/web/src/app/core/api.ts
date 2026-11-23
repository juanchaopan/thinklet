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

/** The signed-in child's own api (interfaces.md, 孩子（孩子登录后）); every other api is the parent's. */
const CHILD_API = '/api/child/';

/**
 * Calls the api. Every response body is checked against its contract schema
 * before anyone uses it, and every failure becomes an ApiError carrying the
 * error code (and the request id, which the screen shows as the error id).
 *
 * A 401 `unauthenticated` means whoever made the request is not signed in:
 * it is announced on `childUnauthenticated` for the child's api and on
 * `unauthenticated` for any other. The parent and the child are signed in
 * apart, so neither hears about the other. A login turned down (such as
 * `login_failed`) is a 401 with its own code, which announces nothing.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly parentSignedOut = new Subject<void>();
  private readonly childSignedOut = new Subject<void>();

  /** Emits whenever the api says the parent is not signed in. */
  readonly unauthenticated = this.parentSignedOut.asObservable();

  /** Emits whenever the api says the child is not signed in. */
  readonly childUnauthenticated = this.childSignedOut.asObservable();

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
      throw this.failure(path, error);
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

  private failure(path: string, error: unknown): ApiError {
    if (!(error instanceof HttpErrorResponse) || error.status === 0) {
      return new ApiError(0, 'network');
    }
    const failure = this.readFailure(error);
    if (failure.status === 401 && failure.code === 'unauthenticated') {
      (path.startsWith(CHILD_API) ? this.childSignedOut : this.parentSignedOut).next();
    }
    return failure;
  }

  /** The error the response carries; a body that is not an error response is called by its status. */
  private readFailure(error: HttpErrorResponse): ApiError {
    const parsed = errorResponseSchema.safeParse(error.error);
    if (!parsed.success) {
      return new ApiError(error.status, error.status === 401 ? 'unauthenticated' : 'internal');
    }
    const { code, requestId, fields } = parsed.data.error;
    return new ApiError(error.status, code, requestId, fields);
  }
}
