import { Inject, Injectable } from '@nestjs/common';
import type { AdminFamily, FamilyRole } from '@thinklet/contracts';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import {
  families,
  familyMembers,
  joinRequests,
  parents,
} from '../../infrastructure/database/schema.js';

/** A parent's login as the identity provider reported it. */
export interface ParentLogin {
  issuer: string;
  subject: string;
  /** The name to create the parent with; an existing parent keeps theirs. */
  name: string;
  email: string | null;
  consentVersion: string;
  consentedAt: Date;
}

/** The parent a login was recorded for, and whether the login created them. */
export interface RecordedLogin {
  id: string;
  created: boolean;
}

export interface ParentRecord {
  id: string;
  name: string;
  email: string | null;
}

/** A family the parent is a member of, with its count of pending join requests. */
export interface MembershipRecord {
  id: string;
  name: string;
  role: FamilyRole;
  pendingRequests: number;
}

/** The queries on parents' own accounts, on the pool or inside one transaction. */
export class ParentStore {
  constructor(protected readonly executor: Executor) {}

  /**
   * Creates the parent on their first login; on every later one updates only
   * the email and the consent, keeping the name. One statement, so two
   * logins at once cannot create the parent twice. A row the statement
   * inserted has no earlier version, which `xmax = 0` tells.
   */
  async upsertParentLogin(login: ParentLogin): Promise<RecordedLogin> {
    const rows = await this.executor
      .insert(parents)
      .values({
        oidcIssuer: login.issuer,
        oidcSubject: login.subject,
        name: login.name,
        email: login.email,
        consentVersion: login.consentVersion,
        consentedAt: login.consentedAt,
      })
      .onConflictDoUpdate({
        target: [parents.oidcIssuer, parents.oidcSubject],
        set: {
          email: login.email,
          consentVersion: login.consentVersion,
          consentedAt: login.consentedAt,
          updatedAt: login.consentedAt,
        },
      })
      .returning({ id: parents.id, created: sql<boolean>`xmax = 0` });
    const row = rows.at(0);
    if (row === undefined) {
      throw new Error('Recording the login returned no parent');
    }
    return row;
  }

  async findParent(parentId: string): Promise<ParentRecord | undefined> {
    const rows = await this.executor
      .select({ id: parents.id, name: parents.name, email: parents.email })
      .from(parents)
      .where(eq(parents.id, parentId));
    return rows.at(0);
  }

  /** The parent's subject at the identity provider, the id Authing knows them by, if they exist. */
  async findSubject(parentId: string): Promise<string | undefined> {
    const rows = await this.executor
      .select({ subject: parents.oidcSubject })
      .from(parents)
      .where(eq(parents.id, parentId));
    return rows.at(0)?.subject;
  }

  /** The id of the parent with the identity provider's issuer and subject, if there is one. */
  async findParentId(issuer: string, subject: string): Promise<string | undefined> {
    const rows = await this.executor
      .select({ id: parents.id })
      .from(parents)
      .where(and(eq(parents.oidcIssuer, issuer), eq(parents.oidcSubject, subject)));
    return rows.at(0)?.id;
  }

  /**
   * Locks the parent's row until the transaction ends and says whether the
   * parent exists. A family cannot take the parent in while it is held,
   * since adding a member checks the parent's row, and a second deletion of
   * the same parent waits for the first and then finds no one.
   */
  async lockParent(parentId: string): Promise<boolean> {
    const rows = await this.executor
      .select({ id: parents.id })
      .from(parents)
      .where(eq(parents.id, parentId))
      .for('update');
    return rows.length > 0;
  }

  /** Whether the parent exists and now has the name. */
  async updateParentName(parentId: string, name: string): Promise<boolean> {
    const rows = await this.executor
      .update(parents)
      .set({ name })
      .where(eq(parents.id, parentId))
      .returning({ id: parents.id });
    return rows.length > 0;
  }

  /** The parent's families in the order they joined them, each with its count of pending requests. */
  async listMemberships(parentId: string): Promise<MembershipRecord[]> {
    return this.executor
      .select({
        id: families.id,
        name: families.name,
        role: familyMembers.role,
        pendingRequests: sql<number>`(
          select count(*) from ${joinRequests}
          where ${joinRequests.familyId} = ${families.id} and ${joinRequests.status} = 'pending'
        )`.mapWith(Number),
      })
      .from(familyMembers)
      .innerJoin(families, eq(families.id, familyMembers.familyId))
      .where(eq(familyMembers.parentId, parentId))
      .orderBy(asc(familyMembers.joinedAt), asc(families.id));
  }

  /** The ids of the families the parent is a member of. */
  async familyIdsOf(parentId: string): Promise<string[]> {
    const rows = await this.executor
      .select({ id: familyMembers.familyId })
      .from(familyMembers)
      .where(eq(familyMembers.parentId, parentId));
    return rows.map(({ id }) => id);
  }

  /** The families the parent is the admin of, in the order they joined them. */
  async adminFamiliesOf(parentId: string): Promise<AdminFamily[]> {
    return this.executor
      .select({ id: families.id, name: families.name })
      .from(familyMembers)
      .innerJoin(families, eq(families.id, familyMembers.familyId))
      .where(and(eq(familyMembers.parentId, parentId), eq(familyMembers.role, 'admin')))
      .orderBy(asc(familyMembers.joinedAt), asc(families.id));
  }

  /**
   * How many of the parent's own requests were approved, rejected or expired
   * and are not yet dismissed by them: the results they have still to see.
   */
  async countRequestResults(parentId: string): Promise<number> {
    const rows = await this.executor
      .select({ results: count() })
      .from(joinRequests)
      .where(
        and(
          eq(joinRequests.parentId, parentId),
          inArray(joinRequests.status, ['approved', 'rejected', 'expired']),
          isNull(joinRequests.dismissedByApplicantAt),
        ),
      );
    return rows.at(0)?.results ?? 0;
  }

  /**
   * Deletes the parent (`.docs/design/data.md`, "parents"): the join
   * requests they made, their rows as a member of any family and their own
   * row, in that order, so no row is left referring to them.
   */
  async deleteParent(parentId: string): Promise<void> {
    await this.executor.delete(joinRequests).where(eq(joinRequests.parentId, parentId));
    await this.executor.delete(familyMembers).where(eq(familyMembers.parentId, parentId));
    await this.executor.delete(parents).where(eq(parents.id, parentId));
  }
}

/**
 * Parents' accounts. Its own queries run on the pool; `transaction` runs a
 * unit of work with the same queries inside one transaction, and hands the
 * work the transaction too, for the audit event of its change.
 */
@Injectable()
export class FamilyRepository extends ParentStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super(database);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: ParentStore, transaction: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      work(new ParentStore(transaction), transaction),
    );
  }
}
