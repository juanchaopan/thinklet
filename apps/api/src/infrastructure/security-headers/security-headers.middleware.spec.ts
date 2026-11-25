import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { securityHeaders } from './security-headers.middleware.js';

// The values from `.docs/design/interfaces.md`, stated here on their own so the
// test checks the design and not the list under test. Names are lower case, as
// Node reports them.
const EXPECTED_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
};

function newExchange(): { request: IncomingMessage; response: ServerResponse } {
  const request = new IncomingMessage(new Socket());
  return { request, response: new ServerResponse(request) };
}

describe('securityHeaders', () => {
  it('sets exactly the six api security headers with the designed values', () => {
    const { request, response } = newExchange();

    securityHeaders(request, response, () => undefined);

    expect({ ...response.getHeaders() }).toStrictEqual(EXPECTED_HEADERS);
  });

  it('sets the headers before passing the request on, once', () => {
    const { request, response } = newExchange();
    const seen: string[][] = [];

    securityHeaders(request, response, () => seen.push(response.getHeaderNames()));

    expect(seen).toEqual([Object.keys(EXPECTED_HEADERS)]);
  });

  it('replaces a value set earlier instead of sending the header twice', () => {
    const { request, response } = newExchange();
    response.setHeader('X-Content-Type-Options', 'sniff');
    response.setHeader('Referrer-Policy', 'unsafe-url');

    securityHeaders(request, response, () => undefined);

    expect(response.getHeader('x-content-type-options')).toBe('nosniff');
    expect(response.getHeader('referrer-policy')).toBe('no-referrer');
  });
});
