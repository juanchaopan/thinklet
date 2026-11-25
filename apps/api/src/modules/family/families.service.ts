import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreateFamilyRequest,
  FamilyDetail,
  FamilyRole,
  UpdateFamilyRequest,
} from '@thinklet/contracts';
import type { Executor } from '../../infrastructure/database/database.module.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { AuditService, byParent, changedFields, type AuditActor } from '../audit/audit.service.js';
import { generateFamilyCode } from './family-code.js';
import {
  FamiliesRepository,
  FamilyCodeTakenError,
  FamilyStore,
  type FamilyRecord,
  type MemberRecord,
} from './families.repository.js';

/** How many codes a new or changed family code tries before giving up (`.docs/design/rules.md`, "家庭"). */
export const FAMILY_CODE_ATTEMPTS = 5;

/** What a route of a family needs of the signed-in parent. */
export type FamilyAccess = 'member' | 'admin';

/** Not a member and no such family are answered the same, so ids reveal nothing. */
export const familyNotFound = () => new ApiError('family_not_found', HttpStatus.NOT_FOUND);
const notAdmin = () => new ApiError('not_admin', HttpStatus.FORBIDDEN);
const notAMember = () => new ApiError('not_a_member', HttpStatus.CONFLICT);
const adminCannotLeave = () => new ApiError('admin_cannot_leave', HttpStatus.CONFLICT);
const alreadyAdmin = () => new ApiError('already_admin', HttpStatus.CONFLICT);

/**
 * Checks the parent's role in a family against what the route needs
 * (`.docs/design/rules.md`, "权限"): a parent who is not a member is answered
 * as if there were no such family, and a member who is not the admin cannot
 * do what needs the admin.
 */
export function requireAccess(role: FamilyRole | undefined, access: FamilyAccess): FamilyRole {
  if (role === undefined) {
    throw familyNotFound();
  }
  if (access === 'admin' && role !== 'admin') {
    throw notAdmin();
  }
  return role;
}

/** The parent and the member they are taking out of a family, by their roles there. */
export interface Removal {
  /** The signed-in parent's role; undefined when they are not a member. */
  by: FamilyRole | undefined;
  /** The role of the parent to take out; undefined when they are not a member. */
  of: FamilyRole | undefined;
  /** Whether the parent is leaving, taking themself out. */
  self: boolean;
}

/**
 * Checks that a member may be taken out of a family (`.docs/design/rules.md`,
 * "权限" and "同时操作"): any member but the admin may leave; only the admin
 * may take out someone else, who must still be a member; the admin can
 * neither leave nor be taken out, so the family always keeps its admin.
 */
export function requireRemoval({ by, of, self }: Removal): void {
  const role = requireAccess(by, self ? 'member' : 'admin');
  if (self ? role === 'admin' : of === 'admin') {
    throw adminCannotLeave();
  }
  if (of === undefined) {
    throw notAMember();
  }
}

/** The fields a change of a family names, in a fixed order, for its audit event. */
export function changedFamilyFields(changes: UpdateFamilyRequest): Array<'name' | 'timezone'> {
  return changedFields(changes, ['name', 'timezone']);
}

/** Who acted on which family, the part every audit event of the family itself shares. */
function onFamily(
  parentId: string,
  familyId: string,
): { actor: AuditActor; targetId: string; familyId: string } {
  return { actor: byParent(parentId), targetId: familyId, familyId };
}

/**
 * A family as the signed-in parent sees it, with their own role and every
 * member marked as them or not. A parent who is not among the members is
 * answered as if there were no such family.
 */
export function toFamilyDetail(
  family: FamilyRecord | undefined,
  members: MemberRecord[],
  parentId: string,
): FamilyDetail {
  const you = members.find((member) => member.parentId === parentId);
  if (family === undefined || you === undefined) {
    throw familyNotFound();
  }
  return {
    ...family,
    role: you.role,
    members: members.map((member) => ({ ...member, you: member.parentId === parentId })),
  };
}

/** The family as the parent sees it, read with the store's queries. */
async function readDetail(
  store: FamilyStore,
  familyId: string,
  parentId: string,
): Promise<FamilyDetail> {
  const [family, members] = await Promise.all([
    store.findFamily(familyId),
    store.listMembers(familyId),
  ]);
  return toFamilyDetail(family, members, parentId);
}

/**
 * Locks the family and checks the parent's role there under the lock. Every
 * change to a family or its join requests starts with it, so a change sees
 * the roles and members left by the changes before it: a parent who handed
 * over the admin role in another tab, or who was taken out, is refused.
 */
export async function lockFor(
  store: FamilyStore,
  familyId: string,
  parentId: string,
  access: FamilyAccess,
): Promise<void> {
  await store.lockFamily(familyId);
  requireAccess(await store.memberRole(familyId, parentId), access);
}

/**
 * Families, their settings and their parents (`.docs/design/interfaces.md`,
 * "家庭"). Every operation checks the parent's membership and role in the
 * database, never from the login. Every change is recorded as an audit
 * event in its own transaction, by the parent who made it.
 */
@Injectable()
export class FamiliesService {
  constructor(
    private readonly repository: FamiliesRepository,
    private readonly audit: AuditService,
  ) {}

  /** Checks that the parent may use a route of the family; the membership check of every family route. */
  async checkAccess(parentId: string, familyId: string, access: FamilyAccess): Promise<void> {
    requireAccess(await this.repository.memberRole(familyId, parentId), access);
  }

  /**
   * The id of the family with the code, or undefined when no family has
   * it, for a child's login, which names the family by its code.
   */
  findIdByCode(code: string): Promise<string | undefined> {
    return this.repository.findIdByCode(code);
  }

  /**
   * The current code of each of the families, by family id, for filling in
   * the login form of a remembered child; a family that does not exist has
   * none.
   */
  codesOf(familyIds: readonly string[]): Promise<Map<string, string>> {
    return this.repository.codesOf(familyIds);
  }

  /** Creates a family with a new code; the parent who creates it is its admin. */
  create(parentId: string, request: CreateFamilyRequest): Promise<FamilyDetail> {
    return this.withNewCode((code) =>
      this.repository.transaction(async (store, transaction) => {
        const familyId = await store.insertFamily({ ...request, code });
        await store.insertMember(familyId, parentId, 'admin');
        await this.audit.record(transaction, {
          ...onFamily(parentId, familyId),
          action: 'family.created',
        });
        return readDetail(store, familyId, parentId);
      }),
    );
  }

  /** Reads the family on the pool; its two queries run side by side and lock nothing. */
  get(parentId: string, familyId: string): Promise<FamilyDetail> {
    return readDetail(this.repository, familyId, parentId);
  }

  /**
   * The admin changes the name, the time zone or both; the last change saved
   * wins. A change that names neither changes nothing and is not recorded.
   */
  update(parentId: string, familyId: string, changes: UpdateFamilyRequest): Promise<FamilyDetail> {
    return this.repository.transaction(async (store, transaction) => {
      await lockFor(store, familyId, parentId, 'admin');
      const fields = changedFamilyFields(changes);
      if (fields.length > 0) {
        await store.updateFamily(familyId, changes);
        await this.audit.record(transaction, {
          ...onFamily(parentId, familyId),
          action: 'family.updated',
          details: { fields },
        });
      }
      return readDetail(store, familyId, parentId);
    });
  }

  /**
   * The admin gives the family a new code. The old code stops working at
   * once, and the pending requests made with it expire with the change.
   */
  changeCode(parentId: string, familyId: string): Promise<FamilyDetail> {
    return this.withNewCode((code) =>
      this.repository.transaction(async (store, transaction) => {
        await lockFor(store, familyId, parentId, 'admin');
        await store.updateCode(familyId, code);
        await store.expirePendingRequests(familyId, new Date());
        await this.audit.record(transaction, {
          ...onFamily(parentId, familyId),
          action: 'family.code_changed',
        });
        return readDetail(store, familyId, parentId);
      }),
    );
  }

  /**
   * The admin hands the admin role to another member and becomes a member.
   * Naming themself is 409 `already_admin` and changes nothing. The admin
   * is demoted before the new one is promoted, so the index that allows one
   * admin per family never sees two.
   */
  transferAdmin(parentId: string, familyId: string, newAdminId: string): Promise<FamilyDetail> {
    return this.repository.transaction(async (store, transaction) => {
      await lockFor(store, familyId, parentId, 'admin');
      if (newAdminId === parentId) {
        throw alreadyAdmin();
      }
      if ((await store.memberRole(familyId, newAdminId)) === undefined) {
        throw notAMember();
      }
      await store.setRole(familyId, parentId, 'member');
      await store.setRole(familyId, newAdminId, 'admin');
      await this.audit.record(transaction, {
        actor: byParent(parentId),
        action: 'member.admin_transferred',
        targetId: newAdminId,
        familyId,
        details: { from: parentId },
      });
      return readDetail(store, familyId, parentId);
    });
  }

  /** The admin takes another member out of the family, or a member leaves it. */
  removeMember(parentId: string, familyId: string, memberId: string): Promise<void> {
    return this.repository.transaction(async (store, transaction) => {
      await store.lockFamily(familyId);
      const by = await store.memberRole(familyId, parentId);
      const self = memberId === parentId;
      const of = self ? by : await store.memberRole(familyId, memberId);
      requireRemoval({ by, of, self });
      await store.deleteMember(familyId, memberId);
      await this.audit.record(transaction, {
        actor: byParent(parentId),
        action: self ? 'member.left' : 'member.removed',
        targetId: memberId,
        familyId,
      });
    });
  }

  /**
   * The admin deletes the family (`.docs/design/rules.md`, "删除家庭"), also
   * while it has other parents, in one transaction that locks the family
   * and checks the role under the lock: a parent who is not a member, or a
   * family already deleted, is 404 `family_not_found`, and a member who is
   * not the admin is 403 `not_admin`. The other parents' accounts and their
   * other families stay. Returns the ids of the children deleted with it,
   * whose login links the caller removes from Redis once this has committed.
   */
  delete(parentId: string, familyId: string): Promise<string[]> {
    return this.repository.transaction(async (store, transaction) => {
      await lockFor(store, familyId, parentId, 'admin');
      return this.deleteWithin(transaction, familyId, byParent(parentId));
    });
  }

  /**
   * Deletes the family with everything in it inside the caller's
   * transaction, which has locked the family and checked who may delete it:
   * its children with their devices and books, its books, its join requests
   * and its members' rows (`.docs/design/rules.md`, "删除家庭"). Records
   * `family.deleted` by the actor with how many children and members went,
   * and returns the children's ids, whose login links the caller removes
   * from Redis once the transaction has committed.
   */
  async deleteWithin(
    transaction: Executor,
    familyId: string,
    actor: AuditActor,
  ): Promise<string[]> {
    const { childIds, members } = await new FamilyStore(transaction).deleteFamily(familyId);
    await this.audit.record(transaction, {
      actor,
      action: 'family.deleted',
      targetId: familyId,
      familyId,
      details: { children: childIds.length, members },
    });
    return childIds;
  }

  /**
   * Runs a write that sets a new family code, drawing another code each time
   * the one drawn is taken. After the last attempt it gives up, and the
   * request is answered with 500 `internal`.
   */
  private async withNewCode<T>(write: (code: string) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= FAMILY_CODE_ATTEMPTS; attempt += 1) {
      try {
        return await write(generateFamilyCode());
      } catch (error) {
        if (!(error instanceof FamilyCodeTakenError)) {
          throw error;
        }
      }
    }
    throw new Error(`No free family code in ${FAMILY_CODE_ATTEMPTS} attempts`);
  }
}
