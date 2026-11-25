import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChildMeResponse } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { ChildSession } from '../auth/child-session.service.js';
import { ChildLoginRepository } from './child-login.repository.js';

/** A child login that no longer counts, answered as no login at all. */
const unauthenticated = () => new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);

const SECOND_MS = 1000;

/**
 * Whether a login issued at `issuedAt` counts after the child's logins were
 * last ended at `sessionsValidAfter` (`.docs/design/data.md`, "children"),
 * both compared in whole seconds, the unit of the JWT's issue time. Both
 * times are the database's. A password reset stores the next whole second
 * after it, so a login issued earlier in the reset's own second, which
 * carries that second, is refused too. The child's creation stores its
 * exact time, and a login in the same second counts: there is no login of
 * the child from before it existed.
 */
export function issuedSinceLastReset(issuedAt: Date, sessionsValidAfter: Date): boolean {
  const seconds = (date: Date) => Math.floor(date.getTime() / SECOND_MS);
  return seconds(issuedAt) >= seconds(sessionsValidAfter);
}

/**
 * The signed-in child (`.docs/design/interfaces.md`, "孩子（孩子登录后）"),
 * and the check every child route makes of a child's login: the child
 * still exists and the login was issued since the last password reset.
 */
@Injectable()
export class ChildService {
  constructor(private readonly repository: ChildLoginRepository) {}

  /**
   * The child module's half of the child's login check: the database's
   * time at which the verified login was found to still count, or
   * undefined when it does not. A login renewed then is issued at that
   * time, so a password reset that follows the check ends the renewed
   * login as well.
   */
  async currentAt(session: ChildSession): Promise<Date | undefined> {
    const check = await this.repository.sessionCheck(session.childId);
    return check !== undefined && issuedSinceLastReset(session.issuedAt, check.sessionsValidAfter)
      ? check.checkedAt
      : undefined;
  }

  /** The signed-in child; one deleted since the login check is no login. */
  async me(childId: string): Promise<ChildMeResponse> {
    const nickname = await this.repository.findNickname(childId);
    if (nickname === undefined) {
      throw unauthenticated();
    }
    return { id: childId, nickname };
  }
}
