import { Injectable } from '@nestjs/common';
import type { AdminFamily } from '@thinklet/contracts';
import type { Executor } from '../../infrastructure/database/database.module.js';
import { AuditService, BY_SYSTEM, byParent, type AuditActor } from '../audit/audit.service.js';
import { FamilyStore } from './families.repository.js';
import { FamiliesService } from './families.service.js';
import { FamilyRepository, type ParentStore } from './family.repository.js';

/** What deciding on a parent's own deletion needs: who they are at Authing and what they run. */
export interface AccountToDelete {
  /** The parent's subject, the id Authing knows them by. */
  subject: string;
  /** The families the parent is the admin of, in the order they joined them. */
  adminFamilies: AdminFamily[];
}

/** What deleting a parent took with it: the ids of the children of the families deleted with them. */
export interface DeletedParent {
  childIds: string[];
}

/** One deletion of a parent under way: its transaction and who is deleting the parent. */
interface Deletion {
  parentId: string;
  transaction: Executor;
  parents: ParentStore;
  families: FamilyStore;
  actor: AuditActor;
}

/**
 * Deletes parents' accounts on this site (`.docs/design/rules.md`, "删除账号";
 * decision 0038): a parent who deletes their own account, once Authing has
 * deleted it there, and a parent Authing reports deleted in its console.
 *
 * Both take the parent away in one transaction. Where the parent is the
 * admin, the family is not left without one: the admin passes to the other
 * parent who joined it first, or, when the parent was its only parent, the
 * family is deleted with everything in it. Then the parent's join requests,
 * memberships and own row go. Every change is recorded as an audit event
 * by whoever made it: the parent for their own deletion, the site itself
 * for one Authing reports. A parent who is already gone is left alone, so
 * a deletion done twice, or reported after the parent deleted themself,
 * changes nothing.
 */
@Injectable()
export class ParentDeletionService {
  constructor(
    private readonly repository: FamilyRepository,
    private readonly familiesService: FamiliesService,
    private readonly audit: AuditService,
  ) {}

  /** The parent's Authing subject and the families they are the admin of; undefined when they are gone. */
  async accountOf(parentId: string): Promise<AccountToDelete | undefined> {
    const [subject, adminFamilies] = await Promise.all([
      this.repository.findSubject(parentId),
      this.repository.adminFamiliesOf(parentId),
    ]);
    return subject === undefined ? undefined : { subject, adminFamilies };
  }

  /**
   * Deletes the parent at their own request, recorded as `parent.deleted`
   * `via: self`. They are no family's admin, which the caller checked
   * before Authing deleted the account; a family made them its admin
   * since then passes on as a console deletion's would. Undefined when the
   * parent is gone already.
   */
  deleteOwnAccount(parentId: string): Promise<DeletedParent | undefined> {
    return this.inTransaction(parentId, byParent(parentId), 'self');
  }

  /**
   * Deletes the parent with the identity provider's issuer and subject,
   * whom Authing reports deleted, recorded as done by the site itself,
   * `parent.deleted` `via: webhook`. Undefined when there is no such
   * parent.
   */
  async deleteReportedAccount(issuer: string, subject: string): Promise<DeletedParent | undefined> {
    const parentId = await this.repository.findParentId(issuer, subject);
    return parentId === undefined ? undefined : this.inTransaction(parentId, BY_SYSTEM, 'webhook');
  }

  private inTransaction(
    parentId: string,
    actor: AuditActor,
    via: 'self' | 'webhook',
  ): Promise<DeletedParent | undefined> {
    return this.repository.transaction((parents, transaction) =>
      this.remove(
        { parentId, transaction, parents, families: new FamilyStore(transaction), actor },
        via,
      ),
    );
  }

  /**
   * Takes the parent away inside the transaction. The parent's families are
   * locked first, in the order of their ids, then the parent's row; once the
   * parent is locked no family can take them in, so the families read again
   * under that lock are all there are, and a family joined in between is
   * locked too. Each change to those families then sees the members left
   * by the changes before it.
   */
  private async remove(
    deletion: Deletion,
    via: 'self' | 'webhook',
  ): Promise<DeletedParent | undefined> {
    const { parentId, transaction, parents, families, actor } = deletion;
    const familyIds = await parents.familyIdsOf(parentId);
    await families.lockFamilies(familyIds);
    if (!(await parents.lockParent(parentId))) {
      return undefined;
    }
    const memberships = await parents.listMemberships(parentId);
    await families.lockFamilies(
      memberships.map(({ id }) => id).filter((id) => !familyIds.includes(id)),
    );

    const childIds: string[] = [];
    for (const { id: familyId } of memberships.filter(({ role }) => role === 'admin')) {
      childIds.push(...(await this.leaveAsAdmin(deletion, familyId)));
    }
    // The audit row reads the parent's Authing identity from their row, so
    // it is written while the row is still there.
    await this.audit.record(transaction, {
      actor,
      action: 'parent.deleted',
      targetId: parentId,
      familyId: null,
      details: { via },
    });
    await parents.deleteParent(parentId);
    return { childIds };
  }

  /**
   * The admin leaves the family: the other parent who joined it first
   * becomes its admin, or, when the admin was its only parent, the family
   * is deleted with everything in it. Answers the ids of the children
   * deleted with the family.
   */
  private async leaveAsAdmin(
    { parentId, transaction, families, actor }: Deletion,
    familyId: string,
  ): Promise<string[]> {
    const successor = (await families.listMembers(familyId)).find(
      (member) => member.parentId !== parentId,
    );
    if (successor === undefined) {
      return this.familiesService.deleteWithin(transaction, familyId, actor);
    }
    await families.deleteMember(familyId, parentId);
    await families.setRole(familyId, successor.parentId, 'admin');
    await this.audit.record(transaction, {
      actor,
      action: 'member.admin_transferred',
      targetId: successor.parentId,
      familyId,
      details: { from: parentId },
    });
    return [];
  }
}
