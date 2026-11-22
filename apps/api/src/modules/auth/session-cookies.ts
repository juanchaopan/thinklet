import type { CookieOptions, Request, Response } from 'express';
import {
  LOGIN_TRANSACTION_LIFETIME_SECONDS,
  SESSION_LIFETIME_SECONDS,
} from './session-lifetime.js';

// The three cookies of the login (`.docs/design/data.md`, "浏览器里存的").
// Every one is HttpOnly, so no script on the page can read it.

/** The session JWT. */
export const SESSION_COOKIE = 'thinklet_session';
/** The identity provider's ID token, kept only for the `id_token_hint` of the logout. */
export const ID_TOKEN_COOKIE = 'thinklet_id_token';
/** The state, nonce, PKCE verifier and return page of a login under way. */
export const LOGIN_TRANSACTION_COOKIE = 'thinklet_login';

const ATTRIBUTES: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

const lasting = (seconds: number): CookieOptions => ({ ...ATTRIBUTES, maxAge: seconds * 1000 });

/** The value of a cookie of the request, or undefined when it has none or it is empty. */
export function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Sets the session JWT and, when there is one, the ID token, both for the
 * session's full lifetime, so the ID token lasts as long as the login.
 */
export function setSessionCookies(
  response: Response,
  sessionToken: string,
  idToken: string | undefined,
): void {
  response.cookie(SESSION_COOKIE, sessionToken, lasting(SESSION_LIFETIME_SECONDS));
  if (idToken !== undefined) {
    response.cookie(ID_TOKEN_COOKIE, idToken, lasting(SESSION_LIFETIME_SECONDS));
  }
}

/** Clears the session JWT and the ID token. */
export function clearSessionCookies(response: Response): void {
  response.clearCookie(SESSION_COOKIE, ATTRIBUTES);
  response.clearCookie(ID_TOKEN_COOKIE, ATTRIBUTES);
}

/** Sets the cookie of a login under way for the transaction's lifetime. */
export function setLoginTransactionCookie(response: Response, token: string): void {
  response.cookie(LOGIN_TRANSACTION_COOKIE, token, lasting(LOGIN_TRANSACTION_LIFETIME_SECONDS));
}

/** Clears the cookie of a login under way. */
export function clearLoginTransactionCookie(response: Response): void {
  response.clearCookie(LOGIN_TRANSACTION_COOKIE, ATTRIBUTES);
}
