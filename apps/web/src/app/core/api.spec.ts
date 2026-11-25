import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  childLoginResponseSchema,
  childMeResponseSchema,
  meResponseSchema,
} from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { worker } from '../../testing/network';
import { LINYUE, REQUEST_ID, stubError } from '../../testing/sample-data';
import { Api, ApiError } from './api';

function api(): Api {
  TestBed.configureTestingModule({ providers: [provideHttpClient()] });
  return TestBed.inject(Api);
}

async function failure(call: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await call.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

/** Listens to both announcements of a 401. */
function listen(client: Api): { parent: () => void; child: () => void } {
  const heard = { parent: vi.fn(), child: vi.fn() };
  client.unauthenticated.subscribe(heard.parent);
  client.childUnauthenticated.subscribe(heard.child);
  return heard;
}

describe('Api', () => {
  it('returns a body that matches its contract', async () => {
    worker.use(http.get('/api/me', () => HttpResponse.json(LINYUE)));

    expect(await api().get('/api/me', meResponseSchema)).toEqual(LINYUE);
  });

  it('treats a body that breaks its contract as a server fault', async () => {
    worker.use(http.get('/api/me', () => HttpResponse.json({ ...LINYUE, id: 'not-a-uuid' })));

    const error = await failure(api().get('/api/me', meResponseSchema));

    expect(error.code).toBe('internal');
  });

  it('carries the error code, the request id and the rejected fields', async () => {
    stubError('patch /api/me', 400, 'invalid_request', {
      fields: [{ path: 'name', code: 'too_long' }],
    });

    const error = await failure(api().send('PATCH', '/api/me', { name: 'x' }, meResponseSchema));

    expect(error.status).toBe(400);
    expect(error.code).toBe('invalid_request');
    expect(error.requestId).toBe(REQUEST_ID);
    expect(error.fields).toEqual([{ path: 'name', code: 'too_long' }]);
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('carries the seconds left of a rate limit', async () => {
    stubError('post /api/child-auth/login', 429, 'rate_limited', { retryAfterSeconds: 412 });

    const error = await failure(
      api().send('POST', '/api/child-auth/login', {}, childLoginResponseSchema),
    );

    expect(error.status).toBe(429);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(412);
  });

  it('calls an error without a readable body internal', async () => {
    worker.use(http.get('/api/me', () => new HttpResponse('Bad gateway', { status: 502 })));

    const error = await failure(api().get('/api/me', meResponseSchema));

    expect(error.status).toBe(502);
    expect(error.code).toBe('internal');
  });

  it('calls a request without an answer network', async () => {
    worker.use(http.get('/api/me', () => HttpResponse.error()));

    const error = await failure(api().get('/api/me', meResponseSchema));

    expect(error.code).toBe('network');
  });

  it("announces a parent's 401 as the parent not being signed in", async () => {
    stubError('get /api/me', 401, 'unauthenticated');
    const client = api();
    const heard = listen(client);

    const error = await failure(client.get('/api/me', meResponseSchema));

    expect(error.code).toBe('unauthenticated');
    expect(heard.parent).toHaveBeenCalledOnce();
    expect(heard.child).not.toHaveBeenCalled();
  });

  it("announces a 401 of the child's api as the child not being signed in", async () => {
    stubError('get /api/child/me', 401, 'unauthenticated');
    const client = api();
    const heard = listen(client);

    const error = await failure(client.get('/api/child/me', childMeResponseSchema));

    expect(error.code).toBe('unauthenticated');
    expect(heard.child).toHaveBeenCalledOnce();
    expect(heard.parent).not.toHaveBeenCalled();
  });

  it('announces nothing for a child login turned down', async () => {
    stubError('post /api/child-auth/login', 401, 'login_failed');
    const client = api();
    const heard = listen(client);

    const error = await failure(
      client.send('POST', '/api/child-auth/login', {}, childLoginResponseSchema),
    );

    expect(error.code).toBe('login_failed');
    expect(heard.parent).not.toHaveBeenCalled();
    expect(heard.child).not.toHaveBeenCalled();
  });

  it('accepts an answer without content', async () => {
    worker.use(
      http.delete('/api/join-requests/:id', () => new HttpResponse(null, { status: 204 })),
    );

    await expect(
      api().sendWithoutContent('DELETE', '/api/join-requests/9c3a'),
    ).resolves.toBeUndefined();
  });
});
