import type { CookieOptions, Request } from 'express';

/**
 * The attributes every cookie the api sets carries: HttpOnly, so no script
 * on the page can read it, Secure, SameSite=Lax and the whole site. Clearing
 * a cookie names the same attributes, or the browser keeps it.
 */
export const COOKIE_ATTRIBUTES: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

/** The attributes of a cookie that lasts `milliseconds` from now. */
export function lastingCookie(milliseconds: number): CookieOptions {
  return { ...COOKIE_ATTRIBUTES, maxAge: milliseconds };
}

/** The value of a cookie of the request, or undefined when it has none or it is empty. */
export function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
