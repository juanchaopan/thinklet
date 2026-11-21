// Drizzle table definitions. drizzle-kit reads this file to generate the
// migrations in apps/api/drizzle/, and the Drizzle client is typed from it.
import type { FamilyRole, JoinRequestStatus } from '@thinklet/contracts';
import { sql } from 'drizzle-orm';
import {
  char,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Every time is stored with its time zone. */
function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true });
}

/** A parent, known by the issuer and subject of their Authing account. */
export const parents = pgTable(
  'parents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oidcIssuer: text('oidc_issuer').notNull(),
    oidcSubject: text('oidc_subject').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    consentVersion: text('consent_version').notNull(),
    consentedAt: timestamptz('consented_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('parents_oidc_identity_unique').on(table.oidcIssuer, table.oidcSubject)],
);

/** A family; its code is unique across the platform. */
export const families = pgTable('families', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  code: char('code', { length: 6 }).notNull().unique('families_code_unique'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * The parents of a family. Leaving or being removed deletes the row. The
 * partial unique index allows at most one admin per family; the services
 * keep it at exactly one.
 */
export const familyMembers = pgTable(
  'family_members',
  {
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.id),
    role: text('role').$type<FamilyRole>().notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.familyId, table.parentId] }),
    uniqueIndex('family_members_one_admin_per_family')
      .on(table.familyId)
      .where(sql`role = 'admin'`),
    check('family_members_role_check', sql`role in ('admin', 'member')`),
  ],
);

/**
 * Requests to join a family. Rows are never deleted; the partial unique
 * index allows one pending request per parent and family at a time.
 */
export const joinRequests = pgTable(
  'join_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.id),
    code: char('code', { length: 6 }).notNull(),
    status: text('status').$type<JoinRequestStatus>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    closedAt: timestamptz('closed_at'),
    closedBy: uuid('closed_by').references(() => parents.id),
    dismissedByApplicantAt: timestamptz('dismissed_by_applicant_at'),
    dismissedByAdminAt: timestamptz('dismissed_by_admin_at'),
  },
  (table) => [
    uniqueIndex('join_requests_one_pending_per_parent')
      .on(table.familyId, table.parentId)
      .where(sql`status = 'pending'`),
    check(
      'join_requests_status_check',
      sql`status in ('pending', 'approved', 'rejected', 'withdrawn', 'expired')`,
    ),
  ],
);
