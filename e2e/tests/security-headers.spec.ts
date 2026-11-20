import { expect, test } from '@playwright/test';

// The security response headers from `.docs/design/interfaces.md`, stated here
// on their own rather than imported from the apps so the test checks the
// design and not the code under test. Names are lower case, as Playwright
// reports them.
const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

const SHARED_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': PERMISSIONS_POLICY,
};

const WEB_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  ...SHARED_HEADERS,
};

const API_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  ...SHARED_HEADERS,
};

/**
 * The security headers of a response, each name present even when the
 * response lacks it, so a missing header and a wrong value both show up in
 * the diff. A header sent twice arrives joined into one value and fails too.
 */
function securityHeaders(headers: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(Object.keys(WEB_HEADERS).map((name) => [name, headers[name]]));
}

test.describe('security response headers', () => {
  test(
    'the home page carries the web security headers',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request }) => {
      const response = await request.get('/');

      expect(response.ok()).toBe(true);
      expect(securityHeaders(response.headers())).toEqual(WEB_HEADERS);
    },
  );

  test(
    'GET /api/health through the web origin carries the api security headers',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request }) => {
      const response = await request.get('/api/health');

      expect(response.ok()).toBe(true);
      expect(securityHeaders(response.headers())).toEqual(API_HEADERS);
    },
  );
});
