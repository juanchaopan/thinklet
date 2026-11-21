import type { NestExpressApplication } from '@nestjs/platform-express';
import { logoutResponseSchema, meResponseSchema } from '@thinklet/contracts';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import request from 'supertest';
import { startAppWithServices, type AppWithServices } from '../support/app.js';
import { testSigningKey, TEST_APP_ORIGIN } from '../support/containers.js';
import { parentBySubject, query } from '../support/database.js';
import {
  cookieHeader,
  expectCleared,
  expectLoginCookieAttributes,
  newUser,
  setCookiesOf,
  signIn,
  startLogin,
  testSessionTokens,
} from '../support/login.js';

const SEVEN_DAYS = 604_800;
const DAY_MS = 24 * 60 * 60 * 1000;

// Acceptance criteria covered: a parent signs in through the identity
// provider and comes back to the page they wanted; the first login creates
// the parent with the provider's name or the email's local part; every login
// updates the email and the consent; the login lasts 7 days and is renewed
// with less than 3.5 days left; logging out clears the login and leaves
// through the provider's logout.
describe('login', () => {
  let started: AppWithServices;
  let app: NestExpressApplication;
  const parentOf = (subject: string) => parentBySubject(started.databaseUrl, subject);

  beforeAll(async () => {
    started = await startAppWithServices();
    ({ app } = started);
  });

  afterAll(async () => {
    await started?.stop();
  });

  describe('GET /api/auth/login', () => {
    it('redirects to the authorization endpoint with PKCE, state, nonce, the scopes and the callback', async () => {
      const { authorizationUrl } = await startLogin(app.getHttpServer());

      expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
        `${started.services.oidc.issuer}/authorize`,
      );
      const parameters = Object.fromEntries(authorizationUrl.searchParams);
      expect(parameters).toMatchObject({
        client_id: started.services.oidc.clientId,
        response_type: 'code',
        redirect_uri: `${TEST_APP_ORIGIN}/api/auth/callback`,
        scope: 'openid profile email',
        code_challenge_method: 'S256',
      });
      for (const name of ['state', 'nonce', 'code_challenge']) {
        expect(parameters[name]).toMatch(/^[\w-]{20,}$/);
      }
    });

    it('keeps the login in a signed 10-minute HttpOnly cookie', async () => {
      const response = await request(app.getHttpServer()).get('/api/auth/login');
      const cookie = setCookiesOf(response)['thinklet_login'];

      expect(response.status).toBe(302);
      expectLoginCookieAttributes(cookie);
      expect(cookie?.attributes['max-age']).toBe('600');
      expect(decodeProtectedHeader(cookie?.value ?? '')).toMatchObject({ alg: 'ES256' });
    });
  });

  describe('a whole login', () => {
    it('creates the parent, sets both cookies for 7 days and returns to the page', async () => {
      const user = newUser({ name: '林悦', email: 'linyue@example.com' });
      const before = Date.now();

      const { response, cookies } = await signIn(app.getHttpServer(), user, '/profile');

      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('/profile');
      const set = setCookiesOf(response);
      for (const name of ['thinklet_session', 'thinklet_id_token']) {
        expectLoginCookieAttributes(set[name]);
        expect(set[name]?.attributes['max-age']).toBe(String(SEVEN_DAYS));
      }
      expectCleared(set['thinklet_login']);

      const parent = await parentOf(user.subject);
      expect(parent).toMatchObject({
        name: '林悦',
        email: 'linyue@example.com',
        consent_version: '2026-11-21',
      });
      expect(parent?.consented_at.getTime()).toBeGreaterThanOrEqual(before - 1000);

      const session = decodeJwt(cookies.thinklet_session);
      expect(Object.keys(session).sort()).toEqual(['exp', 'iat', 'sub']);
      expect(session.sub).toBe(parent?.id);
      expect((session.exp ?? 0) - (session.iat ?? 0)).toBe(SEVEN_DAYS);
      expect(decodeProtectedHeader(cookies.thinklet_session)).toMatchObject({
        alg: 'ES256',
        kid: (JSON.parse(testSigningKey) as { kid: string }).kid,
      });
      expect(decodeJwt(cookies.thinklet_id_token)).toMatchObject({ sub: user.subject });
    });

    it('returns to / without a page', async () => {
      const { response } = await signIn(app.getHttpServer(), newUser());

      expect(response.headers['location']).toBe('/');
    });

    it('names a parent without a name after the part of the email before the @', async () => {
      const user = newUser({ email: 'zhou.zihang@example.com' });

      await signIn(app.getHttpServer(), user);

      expect(await parentOf(user.subject)).toMatchObject({
        name: 'zhou.zihang',
        email: 'zhou.zihang@example.com',
      });
    });

    it('cuts a long name from the provider to 20 characters', async () => {
      const user = newUser({ name: '一二三四五六七八九十一二三四五六七八九十多出来的' });

      await signIn(app.getHttpServer(), user);

      expect((await parentOf(user.subject))?.name).toBe('一二三四五六七八九十一二三四五六七八九十');
    });

    it('keeps the edited name on the next login but updates the email and the consent', async () => {
      const subject = newUser().subject;
      const first = await signIn(app.getHttpServer(), {
        subject,
        claims: { name: '林悦', email: 'old@example.com' },
      });
      await request(app.getHttpServer())
        .patch('/api/me')
        .set('Origin', TEST_APP_ORIGIN)
        .set('Cookie', cookieHeader(first.cookies))
        .send({ name: '悦悦' })
        .expect(200);
      await query(
        started.databaseUrl,
        `update parents set consent_version = 'earlier', consented_at = now() - interval '3 days'
         where oidc_subject = $1`,
        [subject],
      );
      const before = await parentOf(subject);

      await signIn(app.getHttpServer(), {
        subject,
        claims: { name: '新名字', email: 'new@example.com' },
      });

      const after = await parentOf(subject);
      expect(after).toMatchObject({
        id: before?.id,
        name: '悦悦',
        email: 'new@example.com',
        consent_version: '2026-11-21',
      });
      expect(after?.consented_at.getTime()).toBeGreaterThan(
        (before?.consented_at.getTime() ?? 0) + DAY_MS,
      );
    });

    it('clears an email the provider no longer gives', async () => {
      const subject = newUser().subject;
      await signIn(app.getHttpServer(), { subject, claims: { email: 'linyue@example.com' } });

      await signIn(app.getHttpServer(), { subject, claims: { name: '林悦' } });

      expect((await parentOf(subject))?.email).toBeNull();
    });
  });

  describe('GET /api/me', () => {
    it('returns the signed-in parent', async () => {
      const user = newUser({ name: '林悦', email: 'linyue@example.com' });
      const { cookies } = await signIn(app.getHttpServer(), user);

      const response = await request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', cookieHeader(cookies));

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(meResponseSchema.parse(response.body)).toEqual({
        id: (await parentOf(user.subject))?.id,
        name: '林悦',
        email: 'linyue@example.com',
        families: [],
      });
    });

    it('gives a parent without an email a null email', async () => {
      const { cookies } = await signIn(app.getHttpServer(), newUser({ name: '林悦' }));

      const response = await request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', cookieHeader(cookies));

      expect(response.body).toMatchObject({ email: null });
    });

    it('lists the families in joining order, with pending requests only where the parent is admin', async () => {
      const user = newUser({ name: '林悦' });
      const { cookies } = await signIn(app.getHttpServer(), user);
      const parentId = (await parentOf(user.subject))?.id;
      const [other] = await query<{ id: string }>(
        started.databaseUrl,
        `insert into parents (oidc_issuer, oidc_subject, name, consent_version, consented_at)
         values ('issuer', $1, '陈晓', '2026-11-21', now()) returning id`,
        [crypto.randomUUID()],
      );
      const [grandma, home] = await query<{ id: string }>(
        started.databaseUrl,
        `insert into families (name, timezone, code) values
         ('外婆家', 'Asia/Shanghai', 'A2345B'), ('林悦的家', 'Asia/Shanghai', 'A2345C')
         returning id`,
      );
      await query(
        started.databaseUrl,
        `insert into family_members (family_id, parent_id, role, joined_at) values
         ($1, $3, 'member', now() - interval '2 days'),
         ($2, $3, 'admin', now() - interval '1 day')`,
        [grandma?.id, home?.id, parentId],
      );
      // The admin's family has one pending and one rejected request; the
      // other family's pending request is not the member's to see.
      await query(
        started.databaseUrl,
        `insert into join_requests (family_id, parent_id, code, status) values
         ($1, $3, 'A2345C', 'pending'), ($1, $4, 'A2345C', 'rejected'),
         ($2, $3, 'A2345B', 'pending')`,
        [home?.id, grandma?.id, other?.id, parentId],
      );

      const response = await request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', cookieHeader(cookies));

      expect(meResponseSchema.parse(response.body).families).toEqual([
        { id: grandma?.id, name: '外婆家', role: 'member' },
        { id: home?.id, name: '林悦的家', role: 'admin', pendingRequests: 1 },
      ]);
    });

    it('is refused without a login with 401 unauthenticated and the request id', async () => {
      const response = await request(app.getHttpServer()).get('/api/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: 'unauthenticated', requestId: response.headers['x-request-id'] },
      });
    });
  });

  describe('renewal', () => {
    const tokens = testSessionTokens();

    async function meWithSessionIssuedDaysAgo(days: number, idToken?: string) {
      const user = newUser();
      await signIn(app.getHttpServer(), user);
      const parentId = (await parentOf(user.subject))?.id ?? '';
      const session = await tokens.issueSession(parentId, new Date(Date.now() - days * DAY_MS));
      const cookies: Record<string, string> = { thinklet_session: session };
      if (idToken !== undefined) {
        cookies['thinklet_id_token'] = idToken;
      }
      return request(app.getHttpServer()).get('/api/me').set('Cookie', cookieHeader(cookies));
    }

    it('renews a login with less than 3.5 days left for 7 days, with the ID token', async () => {
      const response = await meWithSessionIssuedDaysAgo(4, 'id-token-1');

      expect(response.status).toBe(200);
      const set = setCookiesOf(response);
      expectLoginCookieAttributes(set['thinklet_session']);
      expect(set['thinklet_session']?.attributes['max-age']).toBe(String(SEVEN_DAYS));
      const renewed = decodeJwt(set['thinklet_session']?.value ?? '');
      expect((renewed.exp ?? 0) * 1000).toBeGreaterThan(Date.now() + 6.9 * DAY_MS);
      expectLoginCookieAttributes(set['thinklet_id_token']);
      expect(set['thinklet_id_token']).toMatchObject({
        value: 'id-token-1',
        attributes: { 'max-age': String(SEVEN_DAYS) },
      });
    });

    it('does not renew a login with more than 3.5 days left', async () => {
      const response = await meWithSessionIssuedDaysAgo(3);

      expect(response.status).toBe(200);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('does not accept a login older than 7 days', async () => {
      const response = await meWithSessionIssuedDaysAgo(7.01);

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears both cookies and returns the logout address with the ID token', async () => {
      const { cookies } = await signIn(app.getHttpServer(), newUser());

      const response = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Origin', TEST_APP_ORIGIN)
        .set('Cookie', cookieHeader(cookies));

      expect(response.status).toBe(200);
      const url = new URL(logoutResponseSchema.parse(response.body).endSessionUrl);
      expect(`${url.origin}${url.pathname}`).toBe(`${started.services.oidc.issuer}/endsession`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        id_token_hint: cookies.thinklet_id_token,
        client_id: started.services.oidc.clientId,
        post_logout_redirect_uri: `${TEST_APP_ORIGIN}/`,
      });
      const set = setCookiesOf(response);
      expectCleared(set['thinklet_session']);
      expectCleared(set['thinklet_id_token']);
    });

    it('works without a login, without the hint', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Origin', TEST_APP_ORIGIN);

      expect(response.status).toBe(200);
      const url = new URL(logoutResponseSchema.parse(response.body).endSessionUrl);
      expect(url.searchParams.has('id_token_hint')).toBe(false);
      expect(url.searchParams.get('client_id')).toBe(started.services.oidc.clientId);
    });

    it('leaves the browser without a usable login', async () => {
      const { cookies } = await signIn(app.getHttpServer(), newUser());
      const logout = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Origin', TEST_APP_ORIGIN)
        .set('Cookie', cookieHeader(cookies));
      const left = Object.fromEntries(
        Object.entries(setCookiesOf(logout)).map(([name, cookie]) => [name, cookie.value]),
      );

      const response = await request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', cookieHeader(left));

      expect(response.status).toBe(401);
    });
  });

  describe('errors', () => {
    it.each(['/api/nothing-here', '/elsewhere'])(
      'answers %s with 404 not_found and the request id',
      async (path) => {
        const response = await request(app.getHttpServer()).get(path);

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
          error: { code: 'not_found', requestId: response.headers['x-request-id'] },
        });
      },
    );

    it('answers a body that is not JSON with 400 invalid_request', async () => {
      const { cookies } = await signIn(app.getHttpServer(), newUser());

      const response = await request(app.getHttpServer())
        .patch('/api/me')
        .set('Origin', TEST_APP_ORIGIN)
        .set('Cookie', cookieHeader(cookies))
        .set('Content-Type', 'application/json')
        .send('{');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: { code: 'invalid_request', requestId: response.headers['x-request-id'] },
      });
    });
  });
});
