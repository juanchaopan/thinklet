import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errorResponseSchema } from '@thinklet/contracts';
import { ApiError, RateLimitedError } from './api-error.js';
import { ErrorResponseFilter, errorOutcome } from './error-response.filter.js';

/** An Express response double that records what the filter answers. */
function fakeHttp(request: object = { id: 'request-1' }, headersSent = false) {
  const sent: { status?: number; body?: unknown; ended?: boolean } = {};
  const response = {
    headersSent,
    setHeader: vi.fn(),
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
    },
    end() {
      sent.ended = true;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, sent, response };
}

describe('errorOutcome', () => {
  it('keeps the status, code and fields of an ApiError', () => {
    const fields = [{ path: 'name', code: 'too_long' as const }];

    expect(errorOutcome(new ApiError('invalid_request', HttpStatus.BAD_REQUEST, fields))).toEqual({
      status: 400,
      code: 'invalid_request',
      fields,
    });
    expect(errorOutcome(new ApiError('bad_origin', HttpStatus.FORBIDDEN))).toEqual({
      status: 403,
      code: 'bad_origin',
    });
  });

  it('keeps the seconds left of a rate limit', () => {
    expect(errorOutcome(new RateLimitedError(412))).toEqual({
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds: 412,
    });
  });

  it('answers a missing route with not_found', () => {
    expect(errorOutcome(new NotFoundException())).toEqual({ status: 404, code: 'not_found' });
  });

  it('answers other client errors with invalid_request and their status', () => {
    expect(errorOutcome(new BadRequestException('Unexpected token'))).toEqual({
      status: 400,
      code: 'invalid_request',
    });
    expect(errorOutcome(new PayloadTooLargeException())).toEqual({
      status: 413,
      code: 'invalid_request',
    });
  });

  it('reads the status of an exposed client error from Express middleware', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });

    expect(errorOutcome(tooLarge)).toEqual({ status: 413, code: 'invalid_request' });
  });

  it.each([
    ['an unexpected error', new Error('boom')],
    ['a server error', new ServiceUnavailableException()],
    ['an error with an unexposed status', Object.assign(new Error('x'), { status: 400 })],
    ['a value that is not an error', 'boom'],
  ])('answers %s with a 500 internal', (_name, error) => {
    expect(errorOutcome(error)).toEqual({ status: 500, code: 'internal' });
  });
});

describe('ErrorResponseFilter', () => {
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers with the common error body and the request id', () => {
    const { host, sent, response } = fakeHttp();

    new ErrorResponseFilter().catch(
      new ApiError('invalid_request', HttpStatus.BAD_REQUEST, [{ path: 'name', code: 'required' }]),
      host,
    );

    expect(sent.status).toBe(400);
    expect(errorResponseSchema.parse(sent.body)).toEqual({
      error: {
        code: 'invalid_request',
        requestId: 'request-1',
        fields: [{ path: 'name', code: 'required' }],
      },
    });
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });

  it('answers a rate limit with the seconds left in the body and in Retry-After', () => {
    const { host, sent, response } = fakeHttp();

    new ErrorResponseFilter().catch(new RateLimitedError(412), host);

    expect(sent.status).toBe(429);
    expect(errorResponseSchema.parse(sent.body)).toEqual({
      error: { code: 'rate_limited', requestId: 'request-1', retryAfterSeconds: 412 },
    });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '412');
    expect(logged).not.toHaveBeenCalled();
  });

  it('gives a request that has no id yet a fresh one', () => {
    const { host, sent } = fakeHttp({});

    new ErrorResponseFilter().catch(new NotFoundException(), host);

    expect(sent.body).toEqual({
      error: { code: 'not_found', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    });
  });

  it('logs an unexpected error by its safe description and answers without details', () => {
    const { host, sent } = fakeHttp();

    new ErrorResponseFilter().catch(new Error('cannot reach postgresql://user:pw@host/db'), host);

    expect(sent.body).toEqual({ error: { code: 'internal', requestId: 'request-1' } });
    expect(logged).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'cannot reach [url]' } },
      'Unexpected error',
    );
  });

  it('ends a response whose headers are already sent', () => {
    const { host, sent } = fakeHttp({ id: 'request-1' }, true);

    new ErrorResponseFilter().catch(new Error('late'), host);

    expect(sent).toEqual({ ended: true });
  });
});
