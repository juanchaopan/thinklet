import type { Request, Response } from 'express';
import {
  DEVICE_COOKIE,
  DEVICE_LIFETIME_MS,
  readDeviceToken,
  rememberedUntil,
  setDeviceCookie,
} from './device-cookie.js';
import { newToken } from './tokens.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const requestWith = (cookies: Record<string, unknown> | undefined) =>
  ({ cookies }) as unknown as Request;

describe('rememberedUntil', () => {
  it('is 30 days after the time the browser is remembered or used', () => {
    const now = new Date('2026-11-22T09:12:34.567Z');

    expect(rememberedUntil(now)).toEqual(new Date('2026-12-22T09:12:34.567Z'));
    expect(rememberedUntil(now).getTime() - now.getTime()).toBe(30 * DAY_MS);
  });
});

describe('readDeviceToken', () => {
  it('reads a token this api makes from the device cookie', () => {
    const { token } = newToken();

    expect(readDeviceToken(requestWith({ [DEVICE_COOKIE]: token }))).toBe(token);
  });

  it.each<[string, Record<string, unknown> | undefined]>([
    ['no cookies', undefined],
    ['no device cookie', { thinklet_child_session: newToken().token }],
    ['an empty device cookie', { [DEVICE_COOKIE]: '' }],
    ['a device cookie that is no token of this api', { [DEVICE_COOKIE]: 'guessable' }],
  ])('reads no token from a request with %s', (_case, cookies) => {
    expect(readDeviceToken(requestWith(cookies))).toBeUndefined();
  });
});

describe('setDeviceCookie', () => {
  it('sets the token for 30 days, HttpOnly, Secure, SameSite=Lax, for the whole site', () => {
    const cookie = vi.fn();
    const { token } = newToken();

    setDeviceCookie({ cookie } as unknown as Response, token);

    expect(cookie).toHaveBeenCalledWith(DEVICE_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: DEVICE_LIFETIME_MS,
    });
    expect(DEVICE_LIFETIME_MS).toBe(30 * DAY_MS);
  });
});
