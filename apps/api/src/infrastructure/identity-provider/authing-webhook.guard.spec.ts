import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import type { ApiError } from '../errors/api-error.js';
import {
  AUTHING_WEBHOOK_SECRET_HEADER,
  AuthingWebhookGuard,
  matchesSecret,
} from './authing-webhook.guard.js';

const SECRET = 'webhook-secret-of-the-tests';

function contextWith(headers: Record<string, string | string[]>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

const guard = new AuthingWebhookGuard({
  get: () => SECRET,
} as unknown as ConfigService<Environment, true>);

describe('matchesSecret', () => {
  it('matches the secret itself', () => {
    expect(matchesSecret(SECRET, SECRET)).toBe(true);
  });

  it.each([
    ['no value', undefined],
    ['an empty value', ''],
    ['a value one character short', SECRET.slice(0, -1)],
    ['a value one character long', `${SECRET}x`],
    ['the secret in another case', SECRET.toUpperCase()],
    ['the secret with spaces around', ` ${SECRET} `],
    ['the header sent twice', [SECRET, SECRET]],
  ])('refuses %s', (_case, value) => {
    expect(matchesSecret(value, SECRET)).toBe(false);
  });
});

describe('AuthingWebhookGuard', () => {
  it('reads the secret from the x-authing-token header', () => {
    expect(AUTHING_WEBHOOK_SECRET_HEADER).toBe('x-authing-token');
    expect(guard.canActivate(contextWith({ [AUTHING_WEBHOOK_SECRET_HEADER]: SECRET }))).toBe(true);
  });

  it.each([
    ['without the header', {}],
    ['with a wrong secret', { [AUTHING_WEBHOOK_SECRET_HEADER]: 'wrong-secret-of-the-tests' }],
    ['with the secret in another header', { 'x-authing-webhook-secret': SECRET }],
  ])('refuses a notification %s with 401 unauthenticated', (_case, headers) => {
    expect(() => guard.canActivate(contextWith(headers))).toThrow(
      expect.objectContaining({ code: 'unauthenticated', status: 401 }) as ApiError,
    );
  });
});
