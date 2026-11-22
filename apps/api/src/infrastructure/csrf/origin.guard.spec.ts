import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { ApiError } from '../errors/api-error.js';
import { hasAllowedOrigin, OriginGuard } from './origin.guard.js';

const APP_ORIGIN = 'https://app.example.com';

function contextFor(method: string, origin?: string): ExecutionContext {
  const request = { method, headers: origin === undefined ? {} : { origin } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const guard = new OriginGuard({
  get: () => APP_ORIGIN,
} as unknown as ConfigService<Environment, true>);

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
});
