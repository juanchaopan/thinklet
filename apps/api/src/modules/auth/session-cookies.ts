import type { CookieOptions, Request, Response } from 'express';
import {
  LOGIN_TRANSACTION_LIFETIME_SECONDS,
  SESSION_LIFETIME_SECONDS,
} from './session-lifetime.js';

// The cookies of the parent's and the child's logins (`.docs/design/data.md`,
// "浏览器里存的"). Every one is HttpOnly, so no script on the page can read
// it. The parent and the child each have their own session cookie, so both
// can be signed in on one browser and each logs out alone.

/** The parent's session JWT. */
export const PARENT_SESSION_COOKIE = 'thinklet_session';
/** The identity provider's ID token, kept only for the `id_token_hint` of the parent's logout. */
export const ID_TOKEN_COOKIE = 'thinklet_id_token';
/** The state, nonce, PKCE verifier and return page of a parent's login under way. */
export const LOGIN_TRANSACTION_COOKIE = 'thinklet_login';
/** The child's session JWT. */
export const CHILD_SESSION_COOKIE = 'thinklet_child_session';

const ATTRIBUTES: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

const lasting = (seconds: number): CookieOptions => ({ ...ATTRIBUTES, maxAge: seconds * 1000 });

/** The value of a cookie of the request, or undefined when it has none or it is empty. */
export function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Sets the parent's session JWT and, when there is one, the ID token, both
 * for the session's full lifetime, so the ID token lasts as long as the
 * login.
 */
export function setParentSessionCookies(
  response: Response,
  sessionToken: string,
  idToken: string | undefined,
): void {
  response.cookie(PARENT_SESSION_COOKIE, sessionToken, lasting(SESSION_LIFETIME_SECONDS));
  if (idToken !== undefined) {
    response.cookie(ID_TOKEN_COOKIE, idToken, lasting(SESSION_LIFETIME_SECONDS));
  }
}

/** Clears the parent's session JWT and the ID token; a child's login stays. */
export function clearParentSessionCookies(response: Response): void {
  response.clearCookie(PARENT_SESSION_COOKIE, ATTRIBUTES);
  response.clearCookie(ID_TOKEN_COOKIE, ATTRIBUTES);
}

/** Sets the child's session JWT for the session's full lifetime. */
export function setChildSessionCookie(response: Response, sessionToken: string): void {
  response.cookie(CHILD_SESSION_COOKIE, sessionToken, lasting(SESSION_LIFETIME_SECONDS));
}

/** Clears the child's session JWT; a parent's login stays. */
export function clearChildSessionCookie(response: Response): void {
  response.clearCookie(CHILD_SESSION_COOKIE, ATTRIBUTES);
}

/** Sets the cookie of a login under way for the transaction's lifetime. */
export function setLoginTransactionCookie(response: Response, token: string): void {
  response.cookie(LOGIN_TRANSACTION_COOKIE, token, lasting(LOGIN_TRANSACTION_LIFETIME_SECONDS));
}

/** Clears the cookie of a login under way. */
export function clearLoginTransactionCookie(response: Response): void {
  response.clearCookie(LOGIN_TRANSACTION_COOKIE, ATTRIBUTES);
}
