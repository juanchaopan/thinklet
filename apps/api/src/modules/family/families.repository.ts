import { Inject, Injectable } from '@nestjs/common';
import type { FamilyRole } from '@thinklet/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';
import { translatingUniqueViolation } from '../../infrastructure/database/unique-violation.js';

const { children, families, familyBooks, familyMembers, joinRequests, parents } = schema;

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

/** What deleting a family took with it: its children's ids and how many parents were its members. */
export interface DeletedFamily {
  childIds: string[];
  members: number;
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

  /**
   * Locks the rows of several families until the transaction ends, in the
   * order of their ids, so two transactions that lock some of the same
   * families take them in the same order and cannot wait for each other.
   */
  async lockFamilies(familyIds: readonly string[]): Promise<void> {
    if (familyIds.length === 0) {
      return;
    }
    await this.executor
      .select({ id: families.id })
      .from(families)
      .where(inArray(families.id, [...familyIds]))
      .orderBy(asc(families.id))
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

  /** The id of the family with the code, or undefined when no family has it. */
  async findIdByCode(code: string): Promise<string | undefined> {
    const rows = await this.executor
      .select({ id: families.id })
      .from(families)
      .where(eq(families.code, code));
    return rows.at(0)?.id;
  }

  /** The current code of each of the families, by family id; a family that does not exist has none. */
  async codesOf(familyIds: readonly string[]): Promise<Map<string, string>> {
    if (familyIds.length === 0) {
      return new Map();
    }
    const rows = await this.executor
      .select({ id: families.id, code: families.code })
      .from(families)
      .where(inArray(families.id, [...familyIds]));
    return new Map(rows.map((row) => [row.id, row.code]));
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

  /**
   * Deletes the family and everything in it (`.docs/design/data.md`,
   * "families"): its children, whose remembered devices and assigned books
   * go with them, the books it has, its join requests, its members' rows and
   * the family itself, in that order, so no row is left referring to one
   * already gone. The parents themselves stay. The children's login links
   * live in Redis; the caller removes them by the ids returned, once the
   * transaction has committed.
   */
  async deleteFamily(familyId: string): Promise<DeletedFamily> {
    const deletedChildren = await this.executor
      .delete(children)
      .where(eq(children.familyId, familyId))
      .returning({ id: children.id });
    await this.executor.delete(familyBooks).where(eq(familyBooks.familyId, familyId));
    await this.executor.delete(joinRequests).where(eq(joinRequests.familyId, familyId));
    const deletedMembers = await this.executor
      .delete(familyMembers)
      .where(eq(familyMembers.familyId, familyId))
      .returning({ parentId: familyMembers.parentId });
    await this.executor.delete(families).where(eq(families.id, familyId));
    return {
      childIds: deletedChildren.map(({ id }) => id),
      members: deletedMembers.length,
    };
  }
}

/**
 * Families and their members. Its own queries run on the pool; `transaction`
 * runs a unit of work with the same queries inside one transaction, and
 * hands the work the transaction too, for the audit event of its change.
 */
@Injectable()
export class FamiliesRepository extends FamilyStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super(database);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: FamilyStore, transaction: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      work(new FamilyStore(transaction), transaction),
    );
  }
}
