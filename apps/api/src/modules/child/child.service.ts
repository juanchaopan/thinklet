import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChildMeResponse } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { ChildSession } from '../auth/child-session.service.js';
import { ChildLoginRepository } from './child-login.repository.js';

/** A child login that no longer counts, answered as no login at all. */
const unauthenticated = () => new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);

const SECOND_MS = 1000;

/**
 * The time a password reset at `at` refuses the child's logins before:
 * `at` rounded up to a whole second. A JWT carries its issue time in whole
 * seconds, so a login issued earlier in the reset's own second carries
 * that second too, and only a whole second after the reset refuses it.
 * A login made after the reset within the rest of that second is refused
 * as well, which loses nothing in practice: the reset clears the password
 * and forgets every remembered browser, so the child logs in again only
 * by setting a new password on a login link, which takes far longer.
 */
export function sessionsValidAfterReset(at: Date): Date {
  return new Date(Math.ceil(at.getTime() / SECOND_MS) * SECOND_MS);
}

/**
 * Whether a login issued at `issuedAt` counts after the child's logins were
 * last ended at `sessionsValidAfter` (`.docs/design/data.md`, "children"),
 * both compared in whole seconds, the unit of the JWT's issue time. A reset
 * stores a whole second (`sessionsValidAfterReset`). The child's creation
 * stores its exact time, and a login in the same second counts: there is
 * no login of the child from before it existed.
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

  /** Whether the verified login still counts; the child module's half of the child's login check. */
  async isCurrent(session: ChildSession): Promise<boolean> {
    const sessionsValidAfter = await this.repository.sessionsValidAfter(session.childId);
    return (
      sessionsValidAfter !== undefined && issuedSinceLastReset(session.issuedAt, sessionsValidAfter)
    );
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
