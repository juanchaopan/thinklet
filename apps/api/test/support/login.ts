import type { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { Environment } from '../../src/infrastructure/config/environment.js';
import { SessionTokensService } from '../../src/modules/auth/session-tokens.service.js';
import { testSigningKey } from './containers.js';

// Helpers for tests that sign in through the api and the mock OIDC provider,
// the way a browser does: the login redirect, the provider's interactive
// login page, and the callback with the login cookie.

/** What supertest can send requests to: an in-process server or a base URL. */
export type Target = Parameters<typeof request>[0];

/** One cookie a response sets, with its attributes by lower-case name. */
export interface SetCookie {
  value: string;
  attributes: Record<string, string>;
}

/** The cookies a response sets, by name. */
export function setCookiesOf(response: request.Response): Record<string, SetCookie> {
  const header = response.headers['set-cookie'] as unknown;
  const lines = Array.isArray(header) ? (header as string[]) : [];
  return Object.fromEntries(
    lines.map((line) => {
      const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
      const separator = pair.indexOf('=');
      return [
        pair.slice(0, separator),
        {
          value: decodeURIComponent(pair.slice(separator + 1)),
          attributes: Object.fromEntries(
            attributes.map((attribute) => {
              const [name = '', value = ''] = attribute.split('=');
              return [name.toLowerCase(), value];
            }),
          ),
        },
      ];
    }),
  );
}

/** Asserts the attributes every login cookie has: HttpOnly, Secure, SameSite=Lax, Path=/. */
export function expectLoginCookieAttributes(cookie: SetCookie | undefined): void {
  expect(cookie?.attributes).toMatchObject({
    httponly: '',
    secure: '',
    samesite: 'Lax',
    path: '/',
  });
}

/** Asserts that the response clears the cookie. */
export function expectCleared(cookie: SetCookie | undefined): void {
  expect(cookie?.value).toBe('');
  expect(new Date(cookie?.attributes['expires'] ?? '').getTime()).toBeLessThan(Date.now());
}

/** A Cookie header with the given cookies. */
export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

/** A user of the mock provider: its `sub`, and the claims its ID token carries. */
export interface MockUser {
  subject: string;
  claims?: Record<string, unknown>;
}

/** A user with a fresh subject, so tests do not share parents. */
export function newUser(claims?: Record<string, unknown>): MockUser {
  return { subject: `user-${crypto.randomUUID()}`, ...(claims && { claims }) };
}

export interface StartedLogin {
  /** The provider's authorization address the api redirected to. */
  authorizationUrl: URL;
  /** The value of the login transaction cookie. */
  loginCookie: string;
}

/** GET /api/auth/login, optionally with a page to return to. */
export async function startLogin(target: Target, returnTo?: string): Promise<StartedLogin> {
  const response = await request(target)
    .get('/api/auth/login')
    .query(returnTo === undefined ? {} : { returnTo });
  const loginCookie = setCookiesOf(response)['thinklet_login']?.value;
  const location = response.headers['location'];
  if (response.status !== 302 || loginCookie === undefined || location === undefined) {
    throw new Error(`The login did not start: ${response.status}`);
  }
  return { authorizationUrl: new URL(location), loginCookie };
}

/**
 * Signs in on the mock provider's interactive login page as the user and
 * returns the callback path and query it redirects the browser to.
 */
export async function authorize(authorizationUrl: URL, user: MockUser): Promise<string> {
  const response = await fetch(authorizationUrl, {
    method: 'POST',
    body: new URLSearchParams({
      username: user.subject,
      claims: JSON.stringify(user.claims ?? {}),
    }),
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  if (response.status !== 302 || location === null) {
    throw new Error(`The mock provider did not sign in: ${response.status}`);
  }
  const callback = new URL(location);
  return `${callback.pathname}${callback.search}`;
}

/** GET of the callback path with the login cookie, as the browser sends it back. */
export function callback(target: Target, callbackPath: string, loginCookie?: string) {
  const call = request(target).get(callbackPath);
  return loginCookie === undefined
    ? call
    : call.set('Cookie', cookieHeader({ thinklet_login: loginCookie }));
}

export interface SignedIn {
  /** The callback's response: the redirect and the cookies it sets. */
  response: request.Response;
  /** The session JWT and the ID token, ready for a Cookie header. */
  cookies: { thinklet_session: string; thinklet_id_token: string };
}

/** A whole login: start, the provider's page and the callback. */
export async function signIn(target: Target, user: MockUser, returnTo?: string): Promise<SignedIn> {
  const { authorizationUrl, loginCookie } = await startLogin(target, returnTo);
  const response = await callback(target, await authorize(authorizationUrl, user), loginCookie);
  const set = setCookiesOf(response);
  const session = set['thinklet_session']?.value;
  const idToken = set['thinklet_id_token']?.value;
  if (session === undefined || idToken === undefined) {
    throw new Error(`The login did not complete: ${response.headers['location'] ?? 'no redirect'}`);
  }
  return { response, cookies: { thinklet_session: session, thinklet_id_token: idToken } };
}

/** The api's token service with the signing key of every api the tests start. */
export function testSessionTokens(): SessionTokensService {
  const key: unknown = JSON.parse(testSigningKey);
  return new SessionTokensService({
    get: () => key,
  } as unknown as ConfigService<Environment, true>);
}
