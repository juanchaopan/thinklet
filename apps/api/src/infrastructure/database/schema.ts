// Drizzle table definitions. drizzle-kit reads this file to generate the
// migrations in apps/api/drizzle/, and the Drizzle client is typed from it.
import type { FamilyRole, JoinRequestStatus } from '@thinklet/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
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

/** When a row was created and when it last changed; Drizzle sets the latter on every update. */
function rowTimes() {
  return {
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
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
    ...rowTimes(),
  },
  (table) => [unique('parents_oidc_identity_unique').on(table.oidcIssuer, table.oidcSubject)],
);

/**
 * A family; its code is unique across the platform. Family codes are text
 * with a length check: char(6) would pad a shorter value instead of
 * rejecting it.
 */
export const families = pgTable(
  'families',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    code: text('code').notNull().unique('families_code_unique'),
    ...rowTimes(),
  },
  () => [check('families_code_length_check', sql`char_length(code) = 6`)],
);

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
 * index allows one pending request per parent and family at a time. The
 * code is the family code the parent applied with, checked like the
 * family's own.
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
    code: text('code').notNull(),
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
    check('join_requests_code_length_check', sql`char_length(code) = 6`),
  ],
);

/**
 * A child of a family. The nickname and the account are ciphertexts of the
 * child data cipher; `account_lookup` is the keyed lookup value of the
 * family and the account, which keeps accounts unique within a family and
 * finds the child at login without decrypting. The unique constraint leads
 * with `family_id`, so it also serves listing a family's children. A null
 * `password_hash` means the child has not set a password yet. JWTs issued
 * before `sessions_valid_after` are refused. The guardian's consent is kept
 * in the row and goes with it.
 */
export const children = pgTable(
  'children',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id),
    nickname: text('nickname').notNull(),
    account: text('account').notNull(),
    accountLookup: text('account_lookup').notNull(),
    passwordHash: text('password_hash'),
    sessionsValidAfter: timestamptz('sessions_valid_after').notNull().defaultNow(),
    consentParentId: uuid('consent_parent_id')
      .notNull()
      .references(() => parents.id),
    consentVersion: text('consent_version').notNull(),
    consentedAt: timestamptz('consented_at').notNull(),
    ...rowTimes(),
  },
  (table) => [unique('children_family_account_unique').on(table.familyId, table.accountLookup)],
);

/** The child a row belongs to; the row is deleted with the child. */
function childReference() {
  return uuid('child_id')
    .notNull()
    .references(() => children.id, { onDelete: 'cascade' });
}

/**
 * The one-time login links a parent shows as a QR code. Only the SHA-256
 * of the token is stored; the token itself lives in the link. A link is
 * used, revoked or expired by its time columns.
 */
export const childLoginLinks = pgTable(
  'child_login_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: childReference(),
    tokenHash: text('token_hash').notNull().unique('child_login_links_token_hash_unique'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => parents.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [index('child_login_links_child_id_idx').on(table.childId)],
);

/**
 * The browsers a child is remembered on. A browser has one device token
 * for every child it remembers, so each child has a row of their own with
 * the token's SHA-256; the unique constraint leads with `child_id` for a
 * child's devices, and the token index finds the children a browser
 * remembers. The device name is a ciphertext.
 */
export const childDevices = pgTable(
  'child_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: childReference(),
    tokenHash: text('token_hash').notNull(),
    name: text('name').notNull(),
    rememberedAt: timestamptz('remembered_at').notNull().defaultNow(),
    lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    unique('child_devices_child_token_unique').on(table.childId, table.tokenHash),
    index('child_devices_token_hash_idx').on(table.tokenHash),
  ],
);
