import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { PasswordHasher } from '../../infrastructure/passwords/password-hasher.js';
import type { RateLimiter } from '../../infrastructure/rate-limit/rate-limiter.js';
import { ChildPasswords } from './child-passwords.js';

const CLIENT_IP = '203.0.113.7';
const CHILD_ID = '3f9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';

describe('ChildPasswords', () => {
  /** A limiter that makes every attempt, recording what it was asked to count. */
  const limiter = {
    digest: (...values: string[]) => `digest(${values.join('|')})`,
    attempt: vi.fn((...[, , attempt]: Parameters<RateLimiter['attempt']>) => attempt()),
  };
  const passwords = new ChildPasswords(
    {} as unknown as PasswordHasher,
    limiter as unknown as RateLimiter,
  );

  beforeEach(() => {
    limiter.attempt.mockClear();
  });

  it('counts a source on the child and on all children, 10 and 200 in 15 minutes', async () => {
    await expect(
      passwords.attempt(CLIENT_IP, { childId: CHILD_ID }, () => Promise.resolve('in')),
    ).resolves.toBe('in');

    expect(limiter.attempt).toHaveBeenCalledExactlyOnceWith(
      CLIENT_IP,
      [
        { name: 'child-login', subject: CHILD_ID, limit: 10, windowSeconds: 900 },
        { name: 'child-login', limit: 200, windowSeconds: 900 },
      ],
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('counts a login for no child under the digest of the code in capitals and the account as looked up', async () => {
    await passwords.attempt(CLIENT_IP, { code: '7kq4mz', account: ' XiaoMi ' }, () =>
      Promise.resolve(),
    );

    expect(limiter.attempt.mock.calls[0]?.[1][0]).toMatchObject({
      subject: 'digest(7KQ4MZ|xiaomi)',
    });
  });

  it.each<[ErrorCode, boolean]>([
    ['login_failed', true],
    ['wrong_password', true],
    ['link_invalid', false],
    ['password_not_set', false],
    ['invalid_request', false],
  ])('counts %s as a failure: %s', async (code, counted) => {
    await passwords.attempt(CLIENT_IP, { childId: CHILD_ID }, () => Promise.resolve());
    const isFailure = limiter.attempt.mock.calls[0]?.[3];

    expect(isFailure?.(new ApiError(code, HttpStatus.UNAUTHORIZED))).toBe(counted);
    expect(isFailure?.(new Error(code))).toBe(false);
  });
});
