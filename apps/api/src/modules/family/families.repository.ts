import { Inject, Injectable } from '@nestjs/common';
import type { FamilyRole } from '@thinklet/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { DATABASE, type Database } from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';
import { translatingUniqueViolation } from '../../infrastructure/database/unique-violation.js';

const { families, familyMembers, joinRequests, parents } = schema;

/** The pool or a transaction on it: both run the same queries. */
type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/** The unique constraint that keeps family codes unique across the platform. */
const FAMILY_CODE_UNIQUE = 'families_code_unique';

/**
 * The family code a new or changed family was to get is another family's
 * already. The transaction it happened in is aborted, so it is retried as a
 * whole with a new code.
 */
export class FamilyCodeTakenError extends Error {
  constructor(options?: ErrorOptions) {
    super('The family code is taken', options);
    this.name = 'FamilyCodeTakenError';
  }
}

/** Runs a write that sets a family code, turning a taken code into FamilyCodeTakenError. */
function settingCode<T>(write: () => Promise<T>): Promise<T> {
  return translatingUniqueViolation(
    FAMILY_CODE_UNIQUE,
    (options) => new FamilyCodeTakenError(options),
    write,
  );
}

export interface FamilyRecord {
  id: string;
  name: string;
  timezone: string;
  code: string;
}

export interface MemberRecord {
  parentId: string;
  name: string;
  email: string | null;
  role: FamilyRole;
}

export interface NewFamily {
  name: string;
  timezone: string;
  code: string;
}

export interface FamilyChanges {
  name?: string;
  timezone?: string;
}

/** The queries on families and their members, on the pool or inside one transaction. */
export class FamilyStore {
  constructor(protected readonly executor: Executor) {}

  /**
   * Locks the family's row until the transaction ends, so the changes to a
   * family and its members run one after another: each sees the roles and
   * members the one before it left. Does nothing for a family that does not
   * exist.
   */
  async lockFamily(familyId: string): Promise<void> {
    await this.executor
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .for('update');
  }

  /** The parent's role in the family, or undefined when they are not a member or there is no such family. */
  async memberRole(familyId: string, parentId: string): Promise<FamilyRole | undefined> {
    const rows = await this.executor
      .select({ role: familyMembers.role })
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.parentId, parentId)));
    return rows.at(0)?.role;
  }

  async findFamily(familyId: string): Promise<FamilyRecord | undefined> {
    const rows = await this.executor
      .select({
        id: families.id,
        name: families.name,
        timezone: families.timezone,
        code: families.code,
      })
      .from(families)
      .where(eq(families.id, familyId));
    return rows.at(0);
  }

  /** The family's parents in the order they joined it. */
  async listMembers(familyId: string): Promise<MemberRecord[]> {
    return this.executor
      .select({
        parentId: familyMembers.parentId,
        name: parents.name,
        email: parents.email,
        role: familyMembers.role,
      })
      .from(familyMembers)
      .innerJoin(parents, eq(parents.id, familyMembers.parentId))
      .where(eq(familyMembers.familyId, familyId))
      .orderBy(asc(familyMembers.joinedAt), asc(familyMembers.parentId));
  }

  /** Creates the family and returns its id; throws FamilyCodeTakenError when the code is taken. */
  async insertFamily(family: NewFamily): Promise<string> {
    const rows = await settingCode(() =>
      this.executor.insert(families).values(family).returning({ id: families.id }),
    );
    const row = rows.at(0);
    if (row === undefined) {
      throw new Error('Creating the family returned no row');
    }
    return row.id;
  }

  async insertMember(familyId: string, parentId: string, role: FamilyRole): Promise<void> {
    await this.executor.insert(familyMembers).values({ familyId, parentId, role });
  }

  async updateFamily(familyId: string, changes: FamilyChanges): Promise<void> {
    await this.executor.update(families).set(changes).where(eq(families.id, familyId));
  }

  /** Gives the family a new code; throws FamilyCodeTakenError when the code is taken. */
  async updateCode(familyId: string, code: string): Promise<void> {
    await settingCode(() =>
      this.executor.update(families).set({ code }).where(eq(families.id, familyId)),
    );
  }

  /** Closes the family's pending join requests as expired at the given time. */
  async expirePendingRequests(familyId: string, closedAt: Date): Promise<void> {
    await this.executor
      .update(joinRequests)
      .set({ status: 'expired', closedAt })
      .where(and(eq(joinRequests.familyId, familyId), eq(joinRequests.status, 'pending')));
  }

  async setRole(familyId: string, parentId: string, role: FamilyRole): Promise<void> {
    await this.executor
      .update(familyMembers)
      .set({ role })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.parentId, parentId)));
  }

  async deleteMember(familyId: string, parentId: string): Promise<void> {
    await this.executor
      .delete(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.parentId, parentId)));
  }
}

/**
 * Families and their members. Its own queries run on the pool; `transaction`
 * runs a unit of work with the same queries inside one transaction.
 */
@Injectable()
export class FamiliesRepository extends FamilyStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super(database);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: FamilyStore) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => work(new FamilyStore(transaction)));
  }
}
