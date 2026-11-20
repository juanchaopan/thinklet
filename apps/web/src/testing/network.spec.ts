import { http, HttpResponse } from 'msw';
import { takeUnhandledApiRequests, worker } from './network';

describe('api stubs', () => {
  it('answers a request to /api with the handler the test adds', async () => {
    worker.use(http.get('/api/example', () => HttpResponse.json({ answer: 42 })));

    const response = await fetch('/api/example');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: 42 });
  });

  it('fails a request to /api without a handler and records it', async () => {
    await expect(fetch('/api/example')).rejects.toThrow();

    expect(takeUnhandledApiRequests()).toEqual(['GET /api/example']);
  });
});
