import type { IncomingMessage, ServerResponse } from 'node:http';

// The security response headers of every api response
// (`.docs/design/interfaces.md`, "安全响应头"). The api keeps its own list
// because it shares no code with the web app; responses forwarded through the
// web origin carry this one, not the web's.

/** Header name to value, in the casing they are sent with. */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  // The api answers only with JSON and loads nothing, so the policy allows
  // nothing, and no page may embed a response.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // The same device features the web app turns off.
  'Permissions-Policy': [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
  ].join(', '),
  // No request that follows a response, a login's redirects included,
  // carries the address it came from.
  'Referrer-Policy': 'no-referrer',
});

/**
 * Global functional middleware that sets the security headers before routing,
 * so every response carries them: matched routes, 404s and error responses.
 */
export function securityHeaders(
  _request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  next();
}
