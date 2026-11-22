import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorResponseSchema } from '@thinklet/contracts';
import { base64url, decodeJwt, SignJWT, UnsecuredJWT } from 'jose';
import request from 'supertest';
import type { Environment } from '../../src/infrastructure/config/environment.js';
import {
  SessionTokensService,
  type LoginTransaction,
} from '../../src/modules/auth/session-tokens.service.js';
import { startAppWithServices, type AppWithServices } from '../support/app.js';
import { newSigningKey, testSigningKey, TEST_APP_ORIGIN } from '../support/containers.js';
import { parentBySubject } from '../support/database.js';
import {
  authorize,
  callback,
  cookieHeader,
  expectCleared,
  newUser,
  setCookiesOf,
  signIn,
  startLogin,
  testSessionTokens,
} from '../support/login.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const tokens = testSessionTokens();

/** A token service with another signing key, optionally under the test key's id. */
function otherKeyTokens(sameKeyId: boolean): SessionTokensService {
  const key = JSON.parse(newSigningKey()) as { kid: string };
  if (sameKeyId) {
    key.kid = (JSON.parse(testSigningKey) as { kid: string }).kid;
  }
  return new SessionTokensService({ get: () => key } as unknown as ConfigService<
    Environment,
    true
  >);
}

/** Asserts a callback that did not sign in: back home with the failure, no login, no login cookie. */
function expectLoginFailed(response: request.Response): void {
  expect(response.status).toBe(302);
  expect(response.headers['location']).toBe('/?login=failed');
  const set = setCookiesOf(response);
  expect(set['thinklet_session']).toBeUndefined();
  expect(set['thinklet_id_token']).toBeUndefined();
  expectCleared(set['thinklet_login']);
}

/** Asserts a 403 bad_origin in the common error format. */
function expectBadOrigin(response: request.Response): void {
  expect(response.status).toBe(403);
  expect(errorResponseSchema.parse(response.body).error.code).toBe('bad_origin');
}

describe('login security', () => {
  let started: AppWithServices;
  let app: NestExpressApplication;

  beforeAll(async () => {
    started = await startAppWithServices();
    ({ app } = started);
  });

  afterAll(async () => {
    await started?.stop();
  });

  // Acceptance criterion: the page to return to is only a path of this site.
  describe('the page a login returns to', () => {
    it.each([
      '//evil.example',
      '//evil.example/profile',
      '/\\evil.example',
      '/\\/evil.example',
      'https://evil.example/',
      'http:evil.example',
      'javascript:alert(document.cookie)',
      '/\t/evil.example',
      '/%0a/evil.example\n',
      'evil.example',
    ])('is / when the login was asked to return to %j', async (returnTo) => {
      const { response } = await signIn(app.getHttpServer(), newUser(), returnTo);

      expect(response.headers['location']).toBe('/');
    });
  });

  // Acceptance criterion: a tampered, expired or wrongly signed login is
  // not accepted.
  describe('the session JWT', () => {
    let parentId: string;
    let otherParentId: string;
    let session: string;
    let idToken: string;

    beforeAll(async () => {
      const user = newUser();
      ({
        cookies: { thinklet_session: session, thinklet_id_token: idToken },
      } = await signIn(app.getHttpServer(), user));
      parentId = (await parentBySubject(started.databaseUrl, user.subject))?.id ?? '';
      const other = newUser();
      await signIn(app.getHttpServer(), other);
      otherParentId = (await parentBySubject(started.databaseUrl, other.subject))?.id ?? '';
    });

    const meWith = (token: string) =>
      request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', cookieHeader({ thinklet_session: token }));

    it('is accepted as issued', async () => {
      await meWith(session).expect(200);
    });

    it.each<[string, () => Promise<string>]>([
      [
        'with another parent put into its payload',
        () => {
          const [header, , signature] = session.split('.');
          const payload = { ...decodeJwt(session), sub: otherParentId };
          return Promise.resolve(
            [header, base64url.encode(JSON.stringify(payload)), signature].join('.'),
          );
        },
      ],
      ['signed by another key', () => otherKeyTokens(false).issueSession(parentId)],
      [
        'signed by another key under the same key id',
        () => otherKeyTokens(true).issueSession(parentId),
      ],
      [
        'unsigned (alg none)',
        () =>
          Promise.resolve(
            new UnsecuredJWT({ sub: parentId }).setIssuedAt().setExpirationTime('1h').encode(),
          ),
      ],
      [
        'signed with HS256 and the public key as the secret',
        () => {
          const { kty, crv, x, y, kid } = JSON.parse(testSigningKey) as Record<string, string>;
          return new SignJWT({ sub: parentId })
            .setProtectedHeader({ alg: 'HS256', kid, typ: 'JWT' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(new TextEncoder().encode(JSON.stringify({ kty, crv, x, y })));
        },
      ],
      ['expired', () => tokens.issueSession(parentId, new Date(Date.now() - 7 * DAY_MS - 1000))],
      [
        'a login transaction token instead',
        () =>
          tokens.issueLoginTransaction({
            state: 's',
            nonce: 'n',
            codeVerifier: 'v',
            returnTo: '/',
          }),
      ],
      ["the identity provider's ID token instead", () => Promise.resolve(idToken)],
      ['not a JWT', () => Promise.resolve('not-a-jwt')],
    ])('is refused %s with 401 unauthenticated', async (_name, forge) => {
      const response = await meWith(await forge());

      expect(response.status).toBe(401);
      expect(errorResponseSchema.parse(response.body).error.code).toBe('unauthenticated');
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  // Acceptance criterion: coming back from the provider with an error, a
  // state that does not match or no valid login under way returns home
  // with "登录没有成功".
  describe('the callback', () => {
    it('fails with a state that does not match', async () => {
      const { authorizationUrl, loginCookie } = await startLogin(app.getHttpServer());
      const path = new URL(await authorize(authorizationUrl, newUser()), TEST_APP_ORIGIN);
      path.searchParams.set('state', 'forged-state');

      expectLoginFailed(
        await callback(app.getHttpServer(), `${path.pathname}${path.search}`, loginCookie),
      );
    });

    it('fails without the login cookie', async () => {
      const { authorizationUrl } = await startLogin(app.getHttpServer());

      expectLoginFailed(
        await callback(app.getHttpServer(), await authorize(authorizationUrl, newUser())),
      );
    });

    it('fails with the login cookie of another login', async () => {
      const mine = await startLogin(app.getHttpServer());
      const theirs = await startLogin(app.getHttpServer());

      expectLoginFailed(
        await callback(
          app.getHttpServer(),
          await authorize(mine.authorizationUrl, newUser()),
          theirs.loginCookie,
        ),
      );
    });

    it('fails with a changed login cookie', async () => {
      const { authorizationUrl, loginCookie } = await startLogin(app.getHttpServer());
      const [header, , signature] = loginCookie.split('.');
      const payload = { ...decodeJwt(loginCookie), returnTo: '//evil.example' };
      const changed = [header, base64url.encode(JSON.stringify(payload)), signature].join('.');

      expectLoginFailed(
        await callback(app.getHttpServer(), await authorize(authorizationUrl, newUser()), changed),
      );
    });

    it('fails with a login cookie older than 10 minutes', async () => {
      const { authorizationUrl, loginCookie } = await startLogin(app.getHttpServer());
      const { state, nonce, codeVerifier, returnTo } = decodeJwt(
        loginCookie,
      ) as unknown as LoginTransaction;
      const expired = await tokens.issueLoginTransaction(
        { state, nonce, codeVerifier, returnTo },
        new Date(Date.now() - 10 * 60 * 1000 - 1000),
      );

      expectLoginFailed(
        await callback(app.getHttpServer(), await authorize(authorizationUrl, newUser()), expired),
      );
    });

    it('fails when the same callback is replayed after the login', async () => {
      const { authorizationUrl, loginCookie } = await startLogin(app.getHttpServer());
      const path = await authorize(authorizationUrl, newUser());
      const first = await callback(app.getHttpServer(), path, loginCookie);
      expect(setCookiesOf(first)['thinklet_session']).toBeDefined();

      expectLoginFailed(await callback(app.getHttpServer(), path, loginCookie));
    });

    it('fails when the provider answers with an error, such as a cancelled login', async () => {
      const { authorizationUrl, loginCookie } = await startLogin(app.getHttpServer());
      const state = authorizationUrl.searchParams.get('state') ?? '';

      expectLoginFailed(
        await callback(
          app.getHttpServer(),
          `/api/auth/callback?error=access_denied&state=${state}`,
          loginCookie,
        ),
      );
    });

    it('fails without a code', async () => {
      const { loginCookie } = await startLogin(app.getHttpServer());

      expectLoginFailed(await callback(app.getHttpServer(), '/api/auth/callback', loginCookie));
    });
  });

  // Acceptance criterion: a request that changes data from another site is
  // refused.
  describe('the Origin of requests that change data', () => {
    let cookies: Record<string, string>;
    let subject: string;

    beforeAll(async () => {
      const user = newUser({ name: '林悦' });
      subject = user.subject;
      ({ cookies } = await signIn(app.getHttpServer(), user));
    });

    const badOrigins: Array<[string, string | undefined]> = [
      ['no Origin', undefined],
      ['the null origin', 'null'],
      ['another site', 'https://evil.example'],
      ['the site with a trailing slash', `${TEST_APP_ORIGIN}/`],
      ['the site on another port', 'http://localhost:4201'],
      ['the site on another scheme', 'https://localhost:4200'],
    ];

    it.each(badOrigins)('refuses PATCH /api/me with %s', async (_name, origin) => {
      const call = request(app.getHttpServer())
        .patch('/api/me')
        .set('Cookie', cookieHeader(cookies))
        .send({ name: '被改了' });

      expectBadOrigin(await (origin === undefined ? call : call.set('Origin', origin)));
      expect((await parentBySubject(started.databaseUrl, subject))?.name).toBe('林悦');
    });

    it.each(badOrigins)('refuses POST /api/auth/logout with %s', async (_name, origin) => {
      const call = request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookieHeader(cookies));

      const response = await (origin === undefined ? call : call.set('Origin', origin));

      expectBadOrigin(response);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('refuses a change from another site before checking the login', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/me')
        .set('Origin', 'https://evil.example')
        .send({ name: '被改了' });

      expectBadOrigin(response);
    });

    it('lets reads through from any Origin', async () => {
      await request(app.getHttpServer())
        .get('/api/me')
        .set('Origin', 'https://evil.example')
        .set('Cookie', cookieHeader(cookies))
        .expect(200);
    });

    it('lets a change from the site through', async () => {
      await request(app.getHttpServer())
        .patch('/api/me')
        .set('Origin', TEST_APP_ORIGIN)
        .set('Cookie', cookieHeader(cookies))
        .send({ name: '林悦' })
        .expect(200);
    });
  });
});
