import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { WEB_SECURITY_HEADERS } from './security-headers.ts';

interface AngularJson {
  projects: Record<string, { architect: { serve: { options: { headers?: unknown } } } }>;
}

describe('WEB_SECURITY_HEADERS', () => {
  it('holds exactly the values of the design', () => {
    // Written out as in `.docs/design/interfaces.md`, so a directive lost or
    // reordered in the list shows up here.
    expect(WEB_SECURITY_HEADERS).toEqual({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy':
        'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    });
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(WEB_SECURITY_HEADERS)).toBe(true);
  });

  it('is what ng serve sends, through the copy in angular.json', async () => {
    const angularJson = JSON.parse(
      await readFile(new URL('../angular.json', import.meta.url), 'utf8'),
    ) as AngularJson;

    expect(angularJson.projects['web']?.architect.serve.options.headers).toEqual(
      WEB_SECURITY_HEADERS,
    );
  });
});
