import { Injectable } from '@nestjs/common';
import type { ErrorCode } from '@thinklet/contracts';
import { normaliseAccount } from '../../infrastructure/child-data/child-data-cipher.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { PasswordHasher } from '../../infrastructure/passwords/password-hasher.js';
import { RateLimiter, type RateCounter } from '../../infrastructure/rate-limit/rate-limiter.js';

/** The window of a source's failed child logins, from its first failure (rules.md, 限流). */
export const CHILD_LOGIN_WINDOW_SECONDS = 15 * 60;

/** How many failed logins a source may have on one child in the window. */
export const CHILD_LOGIN_LIMIT_PER_CHILD = 10;

/** How many failed logins a source may have on all children together in the window. */
export const CHILD_LOGIN_LIMIT_PER_SOURCE = 200;

/** The answers of a child login that count as a failure: a wrong family code, account or password. */
const FAILURES: ReadonlySet<ErrorCode> = new Set(['login_failed', 'wrong_password']);

function isLoginFailure(error: unknown): boolean {
  return error instanceof ApiError && FAILURES.has(error.code);
}

/**
 * Whom a login is for: a child the login found, or, when the family code
 * and the account match no child, what was typed for them.
 */
export type LoginSubject = { childId: string } | { code: string; account: string };

/**
 * The passwords children type: a new one is hashed, a typed one verified,
 * and the logins that check one are limited per source (rules.md, 限流).
 *
 * Every login that takes a password counts together: with the family code
 * and the account, setting the first password with them, and on a login
 * link. Two counters are kept, the source on one child and the source on
 * all children, and either at its limit refuses the next login before
 * anything is checked. A login for no child is counted per family code and
 * account as typed (the code in capitals, the account as it is looked up),
 * so the HMAC of the two stands for the child in the key.
 *
 * A login service makes, in `attempt`, the part of a login that can fail
 * with `login_failed` or `wrong_password`, once it knows whom the login is
 * for and before a password is verified.
 */
@Injectable()
export class ChildPasswords {
  constructor(
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
  ) {}

  /** The hash a new password is stored as. */
  hash(password: string): Promise<string> {
    return this.hasher.hash(password);
  }

  /** Whether the password typed is the one of the stored hash; with none, it is checked and refused. */
  verify(password: string, stored: string | null): Promise<boolean> {
    return this.hasher.verify(password, stored);
  }

  /** Makes the login attempt for the client on the subject within the limits. */
  attempt<T>(
    clientIp: string | undefined,
    subject: LoginSubject,
    login: () => Promise<T>,
  ): Promise<T> {
    return this.limiter.attempt(clientIp, this.countersOf(subject), login, isLoginFailure);
  }

  private countersOf(subject: LoginSubject): RateCounter[] {
    const child =
      'childId' in subject
        ? subject.childId
        : this.limiter.digest(subject.code.toUpperCase(), normaliseAccount(subject.account));
    return [
      {
        name: 'child-login',
        subject: child,
        limit: CHILD_LOGIN_LIMIT_PER_CHILD,
        windowSeconds: CHILD_LOGIN_WINDOW_SECONDS,
      },
      {
        name: 'child-login',
        limit: CHILD_LOGIN_LIMIT_PER_SOURCE,
        windowSeconds: CHILD_LOGIN_WINDOW_SECONDS,
      },
    ];
  }
}
