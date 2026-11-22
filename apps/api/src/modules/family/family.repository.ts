import { Inject, Injectable } from '@nestjs/common';
import type { FamilyRole } from '@thinklet/contracts';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infrastructure/database/database.module.js';
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

@Injectable()
export class FamilyRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Creates the parent on their first login; on every later one updates only
   * the email and the consent, keeping the name. One statement, so two
   * logins at once cannot create the parent twice. Returns the parent's id.
   */
  async upsertParentLogin(login: ParentLogin): Promise<string> {
    const rows = await this.database
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
      .returning({ id: parents.id });
    const row = rows.at(0);
    if (row === undefined) {
      throw new Error('Recording the login returned no parent');
    }
    return row.id;
  }

  async findParent(parentId: string): Promise<ParentRecord | undefined> {
    const rows = await this.database
      .select({ id: parents.id, name: parents.name, email: parents.email })
      .from(parents)
      .where(eq(parents.id, parentId));
    return rows.at(0);
  }

  /** Whether the parent exists and now has the name. */
  async updateParentName(parentId: string, name: string): Promise<boolean> {
    const rows = await this.database
      .update(parents)
      .set({ name })
      .where(eq(parents.id, parentId))
      .returning({ id: parents.id });
    return rows.length > 0;
  }

  /** The parent's families in the order they joined them, each with its count of pending requests. */
  async listMemberships(parentId: string): Promise<MembershipRecord[]> {
    return this.database
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

  /**
   * How many of the parent's own requests were approved, rejected or expired
   * and are not yet dismissed by them: the results they have still to see.
   */
  async countRequestResults(parentId: string): Promise<number> {
    const rows = await this.database
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
}
