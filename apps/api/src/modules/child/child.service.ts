import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChildMeResponse } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { ChildSession } from '../auth/child-session.service.js';
import { ChildLoginRepository } from './child-login.repository.js';

/** A child login that no longer counts, answered as no login at all. */
const unauthenticated = () => new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);

/**
 * Whether a login issued at `issuedAt` counts after the child's logins were
 * last ended at `sessionsValidAfter` (`.docs/design/data.md`, "children").
 * The JWT carries its issue time in whole seconds, so the time it is
 * compared with is cut to whole seconds too: a login issued in the same
 * second as the reset, or as the child's creation, counts; one issued in an
 * earlier second does not.
 */
export function issuedSinceLastReset(issuedAt: Date, sessionsValidAfter: Date): boolean {
  const validAfterSecond = Math.floor(sessionsValidAfter.getTime() / 1000) * 1000;
  return issuedAt.getTime() >= validAfterSecond;
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
