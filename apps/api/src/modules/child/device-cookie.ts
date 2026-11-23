import type { Request, Response } from 'express';
import { lastingCookie, readCookie } from '../../infrastructure/authentication/cookies.js';
import { isWellFormedToken } from './tokens.js';

/**
 * The cookie of the browser's device token (`.docs/design/data.md`,
 * "浏览器里存的"), named like the login cookies. Every child the browser
 * remembers shares it. A child's logout leaves it, so the avatars stay.
 */
export const DEVICE_COOKIE = 'thinklet_device';

/** A remembered browser lasts 30 days from its last login (`.docs/design/rules.md`, "在这台设备上记住我"). */
export const DEVICE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** When a browser remembered or used at `now` stops being remembered. */
export function rememberedUntil(now: Date): Date {
  return new Date(now.getTime() + DEVICE_LIFETIME_MS);
}

/**
 * The device token of the request's cookie, or undefined when there is
 * none or it is not a token this api makes, which is then no device token.
 */
export function readDeviceToken(request: Request): string | undefined {
  const value = readCookie(request, DEVICE_COOKIE);
  return isWellFormedToken(value) ? value : undefined;
}

/** Sets the device cookie for 30 days, with the attributes of every cookie the api sets. */
export function setDeviceCookie(response: Response, token: string): void {
  response.cookie(DEVICE_COOKIE, token, lastingCookie(DEVICE_LIFETIME_MS));
}
