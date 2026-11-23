import { Inject, Injectable } from '@nestjs/common';
import type { JoinRequestStatus } from '@thinklet/contracts';
import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infrastructure/database/database.module.js';
import {
  families,
  familyMembers,
  joinRequests,
  parents,
} from '../../infrastructure/database/schema.js';
import { translatingUniqueViolation } from '../../infrastructure/database/unique-violation.js';
import { FamilyStore } from './families.repository.js';

/** The partial unique index that allows one pending request per parent and family. */
const ONE_PENDING_PER_PARENT = 'join_requests_one_pending_per_parent';

/**
 * The parent already has a pending request to the family: another request
 * was recorded between the check and the insert. The transaction it
 * happened in is aborted.
 */
export class RequestPendingError extends Error {
  constructor(options?: ErrorOptions) {
    super('The parent already has a pending request to the family', options);
    this.name = 'RequestPendingError';
  }
}

/** A family found by its code, with its admin's name and parent id. */
export interface CodeFamilyRecord {
  id: string;
  name: string;
  adminName: string;
  adminId: string;
}

/** Who made a request, to which family, and where it stands. */
export interface RequestState {
  familyId: string;
  parentId: string;
  status: JoinRequestStatus;
}

/** A request as its applicant sees it. */
export interface ApplicantRequestRecord {
  id: string;
  familyName: string;
  familyTimezone: string;
  adminName: string;
  status: JoinRequestStatus;
  createdAt: Date;
}

/** A request as the family's admin sees it, with the applicant's parent id, name and email. */
export interface FamilyRequestRecord {
  id: string;
  parentId: string;
  name: string;
  email: string | null;
  status: JoinRequestStatus;
  createdAt: Date;
  closedAt: Date | null;
}

export interface NewRequest {
  familyId: string;
  parentId: string;
  code: string;
}

/** How a request is closed; `closedBy` is the admin who decided it, null when no admin did. */
export interface Closing {
  status: Exclude<JoinRequestStatus, 'pending'>;
  closedAt: Date;
  closedBy: string | null;
}

/** Joins each family to its admin's membership, to read the admin with the family. */
const isFamilyAdmin = and(eq(familyMembers.familyId, families.id), eq(familyMembers.role, 'admin'));

/**
 * The queries on join requests, together with those on families and their
 * members, on the pool or inside one transaction, so a change to a request
 * can lock its family and add the new member in the same transaction.
 */
export class JoinRequestStore extends FamilyStore {
  /** The family with the code and its admin, or undefined when no family has it. */
  async findFamilyByCode(code: string): Promise<CodeFamilyRecord | undefined> {
    const rows = await this.executor
      .select({
        id: families.id,
        name: families.name,
        adminName: parents.name,
        adminId: familyMembers.parentId,
      })
      .from(families)
      .innerJoin(familyMembers, isFamilyAdmin)
      .innerJoin(parents, eq(parents.id, familyMembers.parentId))
      .where(eq(families.code, code));
    return rows.at(0);
  }

  /**
   * Locks the family with the code until the transaction ends and returns its
   * id. A family whose code changes while this waits for the lock is not
   * returned, so a request is never recorded with a code that no longer
   * works.
   */
  async lockFamilyByCode(code: string): Promise<string | undefined> {
    const rows = await this.executor
      .select({ id: families.id })
      .from(families)
      .where(eq(families.code, code))
      .for('update');
    return rows.at(0)?.id;
  }

  async hasPendingRequest(familyId: string, parentId: string): Promise<boolean> {
    const rows = await this.executor
      .select({ id: joinRequests.id })
      .from(joinRequests)
      .where(
        and(
          eq(joinRequests.familyId, familyId),
          eq(joinRequests.parentId, parentId),
          eq(joinRequests.status, 'pending'),
        ),
      );
    return rows.length > 0;
  }

  /** Records a pending request and returns its id; throws RequestPendingError when one is pending already. */
  async insertRequest(request: NewRequest): Promise<string> {
    const rows = await translatingUniqueViolation(
      ONE_PENDING_PER_PARENT,
      (options) => new RequestPendingError(options),
      () =>
        this.executor
          .insert(joinRequests)
          .values({ ...request, status: 'pending' })
          .returning({ id: joinRequests.id }),
    );
    const row = rows.at(0);
    if (row === undefined) {
      throw new Error('Recording the join request returned no row');
    }
    return row.id;
  }

  /** Who made the request and where it stands, or undefined when there is no such request. */
  async findRequest(requestId: string): Promise<RequestState | undefined> {
    const rows = await this.executor
      .select({
        familyId: joinRequests.familyId,
        parentId: joinRequests.parentId,
        status: joinRequests.status,
      })
      .from(joinRequests)
      .where(eq(joinRequests.id, requestId));
    return rows.at(0);
  }

  /** Closes the request with its final status, when and by which admin. */
  async closeRequest(requestId: string, closing: Closing): Promise<void> {
    await this.executor.update(joinRequests).set(closing).where(eq(joinRequests.id, requestId));
  }

  /** Records the applicant's 「知道了」; a request already dismissed keeps its first time. */
  async dismissRequest(requestId: string, at: Date): Promise<void> {
    await this.executor
      .update(joinRequests)
      .set({ dismissedByApplicantAt: at })
      .where(and(eq(joinRequests.id, requestId), isNull(joinRequests.dismissedByApplicantAt)));
  }

  async findApplicantRequest(requestId: string): Promise<ApplicantRequestRecord | undefined> {
    const rows = await this.applicantRequests(eq(joinRequests.id, requestId));
    return rows.at(0);
  }

  /**
   * The parent's requests the start page and the join page list, newest
   * first: the pending ones, and the approved, rejected and expired ones the
   * parent has not dismissed.
   */
  listApplicantRequests(parentId: string): Promise<ApplicantRequestRecord[]> {
    return this.applicantRequests(
      and(
        eq(joinRequests.parentId, parentId),
        or(
          eq(joinRequests.status, 'pending'),
          and(
            inArray(joinRequests.status, ['approved', 'rejected', 'expired']),
            isNull(joinRequests.dismissedByApplicantAt),
          ),
        ),
      ),
    );
  }

  async findFamilyRequest(requestId: string): Promise<FamilyRequestRecord | undefined> {
    const rows = await this.familyRequests(eq(joinRequests.id, requestId), []);
    return rows.at(0);
  }

  /** The family's pending requests, newest first. */
  listPendingRequests(familyId: string): Promise<FamilyRequestRecord[]> {
    return this.familyRequests(
      and(eq(joinRequests.familyId, familyId), eq(joinRequests.status, 'pending')),
      [desc(joinRequests.createdAt), desc(joinRequests.id)],
    );
  }

  /** The family's approved, rejected and expired requests, the latest closed first. */
  listHandledRequests(familyId: string): Promise<FamilyRequestRecord[]> {
    return this.familyRequests(
      and(
        eq(joinRequests.familyId, familyId),
        inArray(joinRequests.status, ['approved', 'rejected', 'expired']),
      ),
      [desc(joinRequests.closedAt), desc(joinRequests.id)],
    );
  }

  /** Requests with their family, its time zone and its admin's name, newest first. */
  private applicantRequests(condition: SQL | undefined): Promise<ApplicantRequestRecord[]> {
    return this.executor
      .select({
        id: joinRequests.id,
        familyName: families.name,
        familyTimezone: families.timezone,
        adminName: parents.name,
        status: joinRequests.status,
        createdAt: joinRequests.createdAt,
      })
      .from(joinRequests)
      .innerJoin(families, eq(families.id, joinRequests.familyId))
      .innerJoin(familyMembers, isFamilyAdmin)
      .innerJoin(parents, eq(parents.id, familyMembers.parentId))
      .where(condition)
      .orderBy(desc(joinRequests.createdAt), desc(joinRequests.id));
  }

  /** Requests with their applicant's parent id, name and email, in the given order. */
  private familyRequests(condition: SQL | undefined, order: SQL[]): Promise<FamilyRequestRecord[]> {
    return this.executor
      .select({
        id: joinRequests.id,
        parentId: joinRequests.parentId,
        name: parents.name,
        email: parents.email,
        status: joinRequests.status,
        createdAt: joinRequests.createdAt,
        closedAt: joinRequests.closedAt,
      })
      .from(joinRequests)
      .innerJoin(parents, eq(parents.id, joinRequests.parentId))
      .where(condition)
      .orderBy(...order);
  }
}

/**
 * Join requests. Its own queries run on the pool; `transaction` runs a unit
 * of work with the same queries inside one transaction.
 */
@Injectable()
export class JoinRequestsRepository extends JoinRequestStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super(database);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: JoinRequestStore) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => work(new JoinRequestStore(transaction)));
  }
}
