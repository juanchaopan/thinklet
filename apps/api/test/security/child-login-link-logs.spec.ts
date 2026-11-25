import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import {
  ChildBrowser,
  DEVICE_COOKIE,
  IPAD_SAFARI,
  linkPath,
  newLoginLink,
} from '../support/child-login.js';
import { addChild, newAccount } from '../support/children.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { createFamily, signInParent } from '../support/families.js';
import { newClientIp } from '../support/rate-limits.js';
import { loggedRequests, loggedUrls } from '../support/request-logs.js';

/** The forms a token takes in a log: as it is, URL-encoded, and in the QR login page's address. */
function tokenForms(token: string): string[] {
  return [
    token,
    encodeURIComponent(token),
    encodeURIComponent(`${TEST_APP_ORIGIN}/child/qr/${token}`),
  ];
}

// The token of a login link logs its child in, so the logs must not hold
// it: not in the URL of any request on the link, whatever the casing, sub
// path or query, nor in the address of the QR login page /child/qr/<token>
// that the browser sends along as the referer, whether the request
// succeeds or fails. Nor may they hold what a child types to log in (the
// password, the account and the family code), the child's nickname that
// the logins answer with, the device token they set, or the IP address the
// child logs in from, which the proxy in front of the api passes on. The
// built api runs as a separate process and everything it writes is read,
// as the platform's log collector would.
describe("Logs of a child's logins", () => {
  const unknownToken = randomBytes(32).toString('base64url');
  const nickname = '米粒logs';
  const account = newAccount();
  const password = `pw-${randomBytes(6).toString('hex')}`;
  const wrongPassword = `pw-${randomBytes(6).toString('hex')}`;
  const shortPassword = '短短的密码';
  const clientIp = newClientIp();
  const secrets: string[] = [];
  let started: BuiltAppWithServices;
  let output: string;

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    const { api } = started;
    const parent = await signInParent(api);
    const family = await createFamily(api, parent);
    const child = await addChild(api, parent, family.id, { nickname, account });
    const first = await newLoginLink(api, parent, family.id, child.id);
    const kid = new ChildBrowser(api, IPAD_SAFARI, clientIp);
    const onLink = (token: string, path: string, body: object) =>
      kid.post(`${linkPath(token)}${path}`, body).then((response) => response.status);
    const fromQrPage = (token: string, call: request.Test) =>
      call.set('Referer', `${TEST_APP_ORIGIN}/child/qr/${token}`);

    // Requests on a token that was never made, in other casings and with
    // the token in the query too.
    await fromQrPage(unknownToken, request(api).get(linkPath(unknownToken)));
    await fromQrPage(
      unknownToken,
      request(api).get(`/API/Child-Login-Links/${unknownToken}?token=${unknownToken}`),
    );
    await fromQrPage(
      unknownToken,
      request(api)
        .post(`${linkPath(unknownToken)}/login?remember=${unknownToken}`)
        .set('Origin', TEST_APP_ORIGIN)
        .send({ password, remember: true }),
    );

    // A real link of a child without a password: read, a password refused,
    // the password set, then every use of the used link refused.
    await fromQrPage(first.token, request(api).get(linkPath(first.token))).expect(200);
    expect(
      await onLink(first.token, '/password', { password: shortPassword, remember: true }),
    ).toBe(400);
    expect(await onLink(first.token, '/password', { password, remember: true })).toBe(200);
    await fromQrPage(first.token, request(api).get(linkPath(first.token))).expect(404);
    expect(await onLink(first.token, '/password', { password, remember: true })).toBe(404);
    expect(await onLink(first.token, '/login', { password, remember: true })).toBe(404);

    // A real link of the child with a password: a wrong one, then the right one.
    const second = await newLoginLink(api, parent, family.id, child.id);
    expect(await onLink(second.token, '/login', { password: wrongPassword, remember: true })).toBe(
      401,
    );
    expect(await onLink(second.token, '/login', { password, remember: true })).toBe(200);

    // Logins with the family code, the account and the password, failing and
    // succeeding, and the avatar of the remembered child.
    const login = { code: family.code, account, password, remember: true };
    expect((await kid.login({ ...login, password: wrongPassword })).status).toBe(401);
    expect((await kid.login({ ...login, code: family.code.toLowerCase() })).status).toBe(200);
    expect((await kid.get('/api/child-auth/remembered')).status).toBe(200);
    expect((await kid.loginRemembered(child.id)).status).toBe(200);
    expect((await kid.me()).status).toBe(200);
    expect((await kid.post('/api/child-auth/logout')).status).toBe(204);

    secrets.push(
      ...tokenForms(unknownToken),
      ...tokenForms(first.token),
      ...tokenForms(second.token),
      kid.cookies.get(DEVICE_COOKIE) ?? '',
      password,
      wrongPassword,
      shortPassword,
      account,
      family.code,
      family.code.toLowerCase(),
      nickname,
      clientIp,
    );
    output = await started.stopApp();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('logs each request on a link with the token replaced', () => {
    const onLinks = loggedUrls(output).filter((url) => /^\/api\/child-login-links\//i.test(url));

    expect(onLinks.length).toBeGreaterThanOrEqual(11);
    for (const url of onLinks) {
      expect(url).toMatch(/^\/api\/child-login-links\/\[redacted\](\/password|\/login)?$/i);
    }
  });

  it('logs the requests without the page address they came from', () => {
    for (const req of loggedRequests(output)) {
      expect(Object.keys(req.headers ?? {})).not.toContain('referer');
    }
  });

  it('logged the logins with the family code, the account and the password', () => {
    expect(loggedUrls(output).filter((url) => url === '/api/child-auth/login')).toHaveLength(2);
  });

  it('contains no token, password, account, family code, nickname or client address of the logins', () => {
    expect(secrets.every((secret) => secret.length > 0)).toBe(true);
    for (const value of secrets) {
      expect(output).not.toContain(value);
    }
  });
});
