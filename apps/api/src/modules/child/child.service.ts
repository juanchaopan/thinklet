import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChildMeResponse } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { AuditService, byChild } from '../audit/audit.service.js';
import type { ChildSession } from '../auth/child-session.service.js';
import { ChildLoginRepository } from './child-login.repository.js';
import { ChildrenRepository } from './children.repository.js';

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

/** The signed-in child as it sees itself: its nickname and account, and its family's name. */
function toChildMe(
  childId: string,
  child: { nickname: string; account: string },
  familyName: string,
): ChildMeResponse {
  return { id: childId, nickname: child.nickname, account: child.account, familyName };
}

/**
 * The signed-in child (`.docs/design/interfaces.md`, "孩子（孩子登录后）"),
 * and the check every child route makes of a child's login: the child
 * still exists and the login was issued since the last password reset.
 * The child sees its nickname, its account and its family's name, and
 * changes its own nickname by the rule the parents change it by; the
 * change is an audit event of the child, in the change's transaction. A
 * child deleted since the login check is answered as no login.
 */
@Injectable()
export class ChildService {
  constructor(
    private readonly repository: ChildLoginRepository,
    private readonly children: ChildrenRepository,
    private readonly audit: AuditService,
  ) {}

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

  /** The signed-in child with its account and its family's name. */
  async me(childId: string): Promise<ChildMeResponse> {
    const profile = await this.repository.findProfile(childId);
    if (profile === undefined) {
      throw unauthenticated();
    }
    return toChildMe(childId, profile, profile.familyName);
  }

  /**
   * Changes the child's own nickname and records it as the child's change
   * in the same transaction. A child belongs to one family for good, so the
   * family is read before the transaction; a parent changing the nickname
   * at the same time is overwritten by whichever is saved last.
   */
  async rename(childId: string, nickname: string): Promise<ChildMeResponse> {
    const profile = await this.repository.findProfile(childId);
    if (profile === undefined) {
      throw unauthenticated();
    }
    const { familyId } = profile;
    const record = await this.children.transaction(async (store, transaction) => {
      const updated = await store.updateChild(familyId, childId, { nickname });
      if (updated !== undefined) {
        await this.audit.record(transaction, {
          actor: byChild(childId),
          action: 'child.updated',
          targetId: childId,
          familyId,
          details: { fields: ['nickname'] },
        });
      }
      return updated;
    });
    if (record === undefined) {
      throw unauthenticated();
    }
    return toChildMe(childId, record, profile.familyName);
  }
}
