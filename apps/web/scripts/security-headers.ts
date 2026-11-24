// The security response headers of every page and static file of the web app
// (`.docs/design/interfaces.md`, "安全响应头"). This one list is what the
// generated vercel.json, the end-to-end test server and `ng serve` send;
// angular.json cannot import it, so a unit test keeps its copy equal.
// Responses under `/api` carry the api's own headers instead.

/** Header name to value, in the casing they are sent with. */
export const WEB_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  // Scripts, images, fonts and requests only from this origin; inline styles
  // are allowed because the Angular runtime inserts component styles as
  // <style> elements. No page may embed this one.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Device features the platform does not use; only names Chrome knows, since
  // an unknown one is reported as a console error.
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
  // No request a page makes, and no link it follows, carries its address, so
  // a family code in `/join/<code>` or a token in `/child/qr/<token>` never
  // leaves the page in a Referer.
  'Referrer-Policy': 'no-referrer',
});
