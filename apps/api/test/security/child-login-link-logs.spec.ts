import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { loggedRequests, loggedUrls } from '../support/request-logs.js';

// The token of a login link logs its child in, so the logs must not hold
// it: not in the URL of any request on the link, whatever the casing, sub
// path or query, nor in the address of the QR login page /child/qr/<token>
// that the browser sends along as the referer. The password a child types
// there must not be logged either. The built api runs as a separate process
// and everything it writes is read, as the platform's log collector would.
// Only the request log is checked here, whatever the api answers; the
// requests that use a real link are checked with the routes that serve them.
describe('Logs of requests on a child login link', () => {
  const token = randomBytes(32).toString('base64url');
  const password = `pw-${randomBytes(6).toString('hex')}`;
  const qrPage = `${TEST_APP_ORIGIN}/child/qr/${token}`;
  let started: BuiltAppWithServices;
  let output: string;

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    const { api } = started;
    const post = (path: string) =>
      request(api)
        .post(path)
        .set('Origin', TEST_APP_ORIGIN)
        .set('Referer', qrPage)
        .send({ password, remember: true });

    await request(api).get(`/api/child-login-links/${token}`).set('Referer', qrPage);
    await request(api).get(`/API/Child-Login-Links/${token}?token=${token}`).set('Referer', qrPage);
    await post(`/api/child-login-links/${token}/password`);
    await post(`/api/child-login-links/${token}/login`);
    await post(`/api/child-login-links/${token}/login?remember=${token}`);

    output = await started.stopApp();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('logs each request on the link with the token replaced', () => {
    const onLinks = loggedUrls(output).filter((url) => /^\/api\/child-login-links\//i.test(url));

    expect(onLinks.length).toBeGreaterThanOrEqual(5);
    for (const url of onLinks) {
      expect(url).toMatch(/^\/api\/child-login-links\/\[redacted\](\/password|\/login)?$/i);
    }
  });

  it('logs the requests without the page address they came from', () => {
    for (const req of loggedRequests(output)) {
      expect(Object.keys(req.headers ?? {})).not.toContain('referer');
    }
  });

  it('contains neither the token, in any form, nor the password', () => {
    for (const value of [token, encodeURIComponent(token), encodeURIComponent(qrPage), password]) {
      expect(output).not.toContain(value);
    }
  });
});
