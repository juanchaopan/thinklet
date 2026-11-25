import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Environment } from '../config/environment.js';
import { ApiError } from '../errors/api-error.js';
import { hasAllowedOrigin, OriginGuard } from './origin.guard.js';
import { SkipOriginCheck } from './skip-origin-check.decorator.js';

const APP_ORIGIN = 'https://app.example.com';

class SiteController {
  change(): void {
    // A route of the site's own pages.
  }
}

@SkipOriginCheck()
class WebhookController {
  notify(): void {
    // A route another server calls.
  }
}

function contextFor(
  method: string,
  origin?: string,
  controller: new () => object = SiteController,
): ExecutionContext {
  const request = { method, headers: origin === undefined ? {} : { origin } };
  const handler = Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => (controller.prototype as Record<string, unknown>)[name])[0];
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

const guard = new OriginGuard(
  { get: () => APP_ORIGIN } as unknown as ConfigService<Environment, true>,
  new Reflector(),
);

describe('hasAllowedOrigin', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])(
    'lets %s through with any Origin or none',
    (method) => {
      expect(hasAllowedOrigin(method, undefined, APP_ORIGIN)).toBe(true);
      expect(hasAllowedOrigin(method, 'https://evil.example', APP_ORIGIN)).toBe(true);
    },
  );

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('lets %s through with the site origin', (method) => {
    expect(hasAllowedOrigin(method, APP_ORIGIN, APP_ORIGIN)).toBe(true);
  });

  it.each([
    ['no Origin', undefined],
    ['the null origin', 'null'],
    ['another site', 'https://evil.example'],
    ['a subdomain', 'https://sub.app.example.com'],
    ['another scheme', 'http://app.example.com'],
    ['another port', 'https://app.example.com:8443'],
    ['a trailing slash', `${APP_ORIGIN}/`],
    ['another case', 'https://APP.example.com'],
    ['the origin as a prefix', `${APP_ORIGIN}.evil.example`],
  ])('refuses a change with %s', (_name, origin) => {
    expect(hasAllowedOrigin('POST', origin, APP_ORIGIN)).toBe(false);
  });
});

describe('OriginGuard', () => {
  it('lets a change from the site through', () => {
    expect(guard.canActivate(contextFor('PATCH', APP_ORIGIN))).toBe(true);
  });

  it('refuses a change from elsewhere with 403 bad_origin', () => {
    expect(() => guard.canActivate(contextFor('POST', 'https://evil.example'))).toThrow(
      expect.objectContaining({ code: 'bad_origin', status: 403 }) as ApiError,
    );
  });

  it('lets a change through without an Origin on a route marked to skip the check', () => {
    expect(guard.canActivate(contextFor('POST', undefined, WebhookController))).toBe(true);
    expect(guard.canActivate(contextFor('POST', 'https://evil.example', WebhookController))).toBe(
      true,
    );
  });
});
