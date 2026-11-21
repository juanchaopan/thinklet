import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestIdOf } from './request-id.js';

function fakeResponse(headersSent = false) {
  const headers = new Map<string, unknown>();
  const response = {
    headersSent,
    setHeader: (name: string, value: unknown) => headers.set(name, value),
  } as unknown as ServerResponse;
  return { response, headers };
}

describe('requestIdOf', () => {
  it('keeps the id a request already has', () => {
    const { response, headers } = fakeResponse();
    const request = { id: 'request-1' } as unknown as IncomingMessage;

    expect(requestIdOf(request, response)).toBe('request-1');
    expect(headers.size).toBe(0);
  });

  it('gives a request without one a fresh id, once, and returns it in the header', () => {
    const { response, headers } = fakeResponse();
    const request = {} as IncomingMessage;

    const id = requestIdOf(request, response);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdOf(request, response)).toBe(id);
    expect(headers.get('X-Request-Id')).toBe(id);
  });

  it('sets no header once the headers are sent', () => {
    const { response, headers } = fakeResponse(true);

    requestIdOf({} as IncomingMessage, response);

    expect(headers.size).toBe(0);
  });
});
