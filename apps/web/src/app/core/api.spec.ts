import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { meResponseSchema } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { worker } from '../../testing/network';
import { LINYUE, stubError } from '../../testing/sample-data';
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
    expect(error.requestId).toBe('a1f3-92c0');
    expect(error.fields).toEqual([{ path: 'name', code: 'too_long' }]);
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

  it('announces every 401', async () => {
    stubError('get /api/me', 401, 'unauthenticated');
    const client = api();
    const announced = vi.fn();
    client.unauthenticated.subscribe(announced);

    const error = await failure(client.get('/api/me', meResponseSchema));

    expect(error.code).toBe('unauthenticated');
    expect(announced).toHaveBeenCalledOnce();
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
