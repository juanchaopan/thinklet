import { applicantJoinRequestSchema, familyDetailSchema } from '@thinklet/contracts';
import type request from 'supertest';
import { acquire, acquisitionPath, ACTIVE_BOOK, readersPath, setReaders } from './books.js';
import { ChildBrowser, linkPath, newLoginLink, signInWithNewPassword } from './child-login.js';
import { addChild, childPath, childrenPath, insertDevice } from './children.js';
import { query } from './database.js';
import {
  addMember,
  applyToFamily,
  as,
  createFamily,
  signInParent,
  type Parent,
} from './families.js';
import { redisContents } from './login-links.js';
import { authorize, callback, newUser, startLogin, type Target } from './login.js';

// Helpers for tests of the audit events: the rows a request adds, a
// snapshot of the business tables and of the login links in Redis, a way
// to make writing an action's row fail, the personal data the tests hand
// out, and every data-changing request of the api as a case that sets it
// up, makes it and names the row it should leave.

/** A row of the audit_events table. */
export interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_kind: string;
  actor_id: string | null;
  actor_issuer: string | null;
  actor_subject: string | null;
  action: string;
  target_kind: string;
  target_id: string;
  family_id: string | null;
  details: Record<string, unknown>;
}

/** An audit row without the two columns the database fills in. */
export type ExpectedAudit = Omit<AuditRow, 'id' | 'occurred_at'>;

/** An expected audit row without its actor's columns. */
type ExpectedAction = Omit<
  ExpectedAudit,
  'actor_kind' | 'actor_id' | 'actor_issuer' | 'actor_subject'
>;

/** Every audit row, oldest first. */
export function auditRows(databaseUrl: string): Promise<AuditRow[]> {
  return query<AuditRow>(databaseUrl, 'select * from audit_events order by occurred_at, id');
}

/** The audit rows the work adds, oldest first, with what the work returned. */
export async function rowsAddedBy<T>(
  databaseUrl: string,
  work: () => Promise<T>,
): Promise<{ result: T; added: AuditRow[] }> {
  const before = new Set((await auditRows(databaseUrl)).map(({ id }) => id));
  const result = await work();
  const added = (await auditRows(databaseUrl)).filter(({ id }) => !before.has(id));
  return { result, added };
}

/** Every table of business data, which an action that fails as a whole leaves as it was. */
const BUSINESS_TABLES = [
  'parents',
  'families',
  'family_members',
  'join_requests',
  'children',
  'child_devices',
  'family_books',
  'book_assignments',
];

/** The prefixes of the keys of business data in Redis: the login links, not the rate limits' counts. */
const BUSINESS_KEY_PREFIXES = ['login-link:', 'login-link-status:', 'child-login-link:'];

/**
 * Every row of the business tables, each table's rows in a fixed order,
 * and every key of business data in Redis with its value, in key order.
 */
export async function businessSnapshot(
  databaseUrl: string,
  redisUrl: string,
): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    BUSINESS_TABLES.map(async (table) => {
      const [row] = await query<{ rows: unknown }>(
        databaseUrl,
        `select coalesce(json_agg(t order by t::text), '[]') as rows from ${table} t`,
      );
      return [table, row?.rows] as const;
    }),
  );
  const keys = (await redisContents(redisUrl))
    .filter(({ key }) => BUSINESS_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .map(({ key, value }) => [key, value] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return { ...Object.fromEntries(entries), redis: keys };
}

/**
 * Runs the work while the database refuses every new audit row of the
 * action, as if writing it failed. The check is not validated against the
 * rows there already, which may have the action.
 */
export async function refusingAuditOf<T>(
  databaseUrl: string,
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z_.]+$/.test(action)) {
    throw new Error(`Not an action: ${action}`);
  }
  await query(
    databaseUrl,
    `alter table audit_events add constraint audit_events_refused_in_test check (action <> '${action}') not valid`,
  );
  try {
    return await work();
  } finally {
    await query(
      databaseUrl,
      'alter table audit_events drop constraint audit_events_refused_in_test',
    );
  }
}

/**
 * The personal data the cases give the api: names, emails, family names,
 * nicknames, accounts and device names, each one new. Every value handed
 * out is kept, for a test that looks for them where they must not be.
 */
export class PersonalData {
  readonly given: string[] = [];
  private count = 0;

  parentClaims(): { name: string; email: string } {
    const n = this.next();
    return { name: this.keep(`林悦${n}`), email: this.keep(`linyue${n}@example.com`) };
  }

  parentName(): string {
    return this.keep(`周子航${this.next()}`);
  }

  familyName(): string {
    return this.keep(`林悦的家${this.next()}`);
  }

  nickname(): string {
    return this.keep(`小米${this.next()}`);
  }

  account(): string {
    return this.keep(`xiaomi${this.next()}${crypto.randomUUID().slice(0, 6).replaceAll('-', '')}`);
  }

  deviceName(): string {
    return this.keep(`iPad · Safari ${this.next()}`);
  }

  private next(): number {
    this.count += 1;
    return this.count;
  }

  private keep(value: string): string {
    this.given.push(value);
    return value;
  }
}

/** What a case's request runs against and the personal data it gives. */
export interface AuditContext {
  target: Target;
  databaseUrl: string;
  personal: PersonalData;
}

/** A change set up and ready to make. */
export interface ArrangedChange {
  act: () => Promise<request.Response>;
  /** The status of the change when it succeeds. */
  status: number;
  /** The status when its audit row cannot be written; 500 unless the request says otherwise. */
  failedStatus?: number;
  /** The one audit row the change should leave, given its response. */
  expected: (response: request.Response) => Promise<ExpectedAudit>;
}

/** A data-changing request of the api, by the audit action it records. */
export interface AuditCase {
  action: string;
  arrange: (context: AuditContext) => Promise<ArrangedChange>;
}

/** The version of the guardian's consent the api records with a new child. */
const CHILD_CONSENT_VERSION = '2026-11-22';

/** The actor columns of the parent's audit rows: their id and their Authing identity. */
async function parentActor(
  databaseUrl: string,
  parentId: string,
): Promise<Pick<ExpectedAudit, 'actor_kind' | 'actor_id' | 'actor_issuer' | 'actor_subject'>> {
  const [row] = await query<{ oidc_issuer: string; oidc_subject: string }>(
    databaseUrl,
    'select oidc_issuer, oidc_subject from parents where id = $1',
    [parentId],
  );
  if (row === undefined) {
    throw new Error(`No parent ${parentId}`);
  }
  return {
    actor_kind: 'parent',
    actor_id: parentId,
    actor_issuer: row.oidc_issuer,
    actor_subject: row.oidc_subject,
  };
}

/** The audit row of the parent's action on the target, in the family or in none. */
async function byParent(
  databaseUrl: string,
  parentId: string,
  row: ExpectedAction,
): Promise<ExpectedAudit> {
  return { ...(await parentActor(databaseUrl, parentId)), ...row };
}

/** The audit row of the child's own action: a child has an id and no Authing identity. */
function byChild(childId: string, row: ExpectedAction): Promise<ExpectedAudit> {
  return Promise.resolve({
    actor_kind: 'child',
    actor_id: childId,
    actor_issuer: null,
    actor_subject: null,
    ...row,
  });
}

/** A parent signed in with personal data of their own. */
function newParent({ target, personal }: AuditContext): Promise<Parent> {
  return signInParent(target, personal.parentClaims());
}

/** A family of a new admin, named with personal data. */
async function newFamily(context: AuditContext) {
  const admin = await newParent(context);
  const family = await createFamily(context.target, admin, {
    name: context.personal.familyName(),
    timezone: 'Asia/Shanghai',
  });
  return { admin, family };
}

/** A family of a new admin and a new member. */
async function familyWithMember(context: AuditContext) {
  const { admin, family } = await newFamily(context);
  const member = await newParent(context);
  await addMember(context.databaseUrl, family.id, member.id);
  return { admin, member, family };
}

/** A family of a new admin with a child named with personal data. */
async function familyWithChild(context: AuditContext) {
  const { admin, family } = await newFamily(context);
  const child = await addChild(context.target, admin, family.id, {
    nickname: context.personal.nickname(),
    account: context.personal.account(),
  });
  return { admin, family, child };
}

/** A family with a child remembered on a browser named with personal data. */
async function familyWithDevice(context: AuditContext) {
  const { admin, family, child } = await familyWithChild(context);
  const now = new Date();
  const deviceId = await insertDevice(context.databaseUrl, child.id, {
    name: context.personal.deviceName(),
    rememberedAt: now,
    lastUsedAt: now,
  });
  return { admin, family, child, deviceId };
}

/** A pending request of a new applicant to a new family. */
async function pendingRequest(context: AuditContext) {
  const { admin, family } = await newFamily(context);
  const applicant = await newParent(context);
  const pending = await applyToFamily(context.target, applicant, family.code);
  return { admin, family, applicant, requestId: pending.id };
}

/** The admin's decision on a pending request, by its audit action. */
function decisionCase(decision: 'approve' | 'reject'): AuditCase {
  return {
    action: decision === 'approve' ? 'join_request.approved' : 'join_request.rejected',
    arrange: async (context) => {
      const { admin, family, applicant, requestId } = await pendingRequest(context);
      return {
        act: () =>
          as(context.target, admin).post(
            `/api/families/${family.id}/join-requests/${requestId}/${decision}`,
          ),
        status: 200,
        expected: () =>
          byParent(context.databaseUrl, admin.id, {
            action: decision === 'approve' ? 'join_request.approved' : 'join_request.rejected',
            target_kind: 'join_request',
            target_id: requestId,
            family_id: family.id,
            details: { parentId: applicant.id },
          }),
      };
    },
  };
}

/** A change of the parent to the family's child, recorded without details unless given. */
function childCase(
  action: string,
  change: (
    context: AuditContext,
    parent: Parent,
    path: string,
  ) => { act: () => Promise<request.Response>; status: number; details?: Record<string, unknown> },
): AuditCase {
  return {
    action,
    arrange: async (context) => {
      const { admin, family, child } = await familyWithChild(context);
      const { act, status, details = {} } = change(context, admin, childPath(family.id, child.id));
      return {
        act,
        status,
        expected: () =>
          byParent(context.databaseUrl, admin.id, {
            action,
            target_kind: 'child',
            target_id: child.id,
            family_id: family.id,
            details,
          }),
      };
    },
  };
}

/** A change of the family by its admin, recorded on the family. */
function familyCase(
  action: string,
  change: (
    context: AuditContext,
    admin: Parent,
    familyId: string,
  ) => { act: () => Promise<request.Response>; details?: Record<string, unknown> },
): AuditCase {
  return {
    action,
    arrange: async (context) => {
      const { admin, family } = await newFamily(context);
      const { act, details = {} } = change(context, admin, family.id);
      return {
        act,
        status: 200,
        expected: () =>
          byParent(context.databaseUrl, admin.id, {
            action,
            target_kind: 'family',
            target_id: family.id,
            family_id: family.id,
            details,
          }),
      };
    },
  };
}

/**
 * Every request of the api that changes data, each with the audit row it
 * leaves (`.docs/design/data.md`, "audit_events").
 */
export const AUDIT_CASES: AuditCase[] = [
  {
    action: 'parent.created',
    arrange: async (context) => {
      const user = newUser(context.personal.parentClaims());
      const { authorizationUrl, loginCookie } = await startLogin(context.target);
      const callbackPath = await authorize(authorizationUrl, user);
      return {
        act: () => callback(context.target, callbackPath, loginCookie),
        status: 302,
        failedStatus: 302,
        expected: async () => {
          const [parent] = await query<{ id: string }>(
            context.databaseUrl,
            'select id from parents where oidc_subject = $1',
            [user.subject],
          );
          const parentId = parent?.id ?? '';
          return byParent(context.databaseUrl, parentId, {
            action: 'parent.created',
            target_kind: 'parent',
            target_id: parentId,
            family_id: null,
            details: {},
          });
        },
      };
    },
  },
  {
    action: 'parent.renamed',
    arrange: async (context) => {
      const parent = await newParent(context);
      return {
        act: () =>
          as(context.target, parent).patch('/api/me', { name: context.personal.parentName() }),
        status: 200,
        expected: () =>
          byParent(context.databaseUrl, parent.id, {
            action: 'parent.renamed',
            target_kind: 'parent',
            target_id: parent.id,
            family_id: null,
            details: {},
          }),
      };
    },
  },
  {
    action: 'family.created',
    arrange: async (context) => {
      const parent = await newParent(context);
      return {
        act: () =>
          as(context.target, parent).post('/api/families', {
            name: context.personal.familyName(),
            timezone: 'Asia/Shanghai',
          }),
        status: 201,
        expected: (response) => {
          const { id } = familyDetailSchema.parse(response.body);
          return byParent(context.databaseUrl, parent.id, {
            action: 'family.created',
            target_kind: 'family',
            target_id: id,
            family_id: id,
            details: {},
          });
        },
      };
    },
  },
  familyCase('family.updated', (context, admin, familyId) => ({
    act: () =>
      as(context.target, admin).patch(`/api/families/${familyId}`, {
        name: context.personal.familyName(),
        timezone: 'Europe/London',
      }),
    details: { fields: ['name', 'timezone'] },
  })),
  familyCase('family.code_changed', (context, admin, familyId) => ({
    act: () => as(context.target, admin).post(`/api/families/${familyId}/code`),
  })),
  {
    action: 'member.admin_transferred',
    arrange: async (context) => {
      const { admin, member, family } = await familyWithMember(context);
      return {
        act: () =>
          as(context.target, admin).put(`/api/families/${family.id}/admin`, {
            parentId: member.id,
          }),
        status: 200,
        expected: () =>
          byParent(context.databaseUrl, admin.id, {
            action: 'member.admin_transferred',
            target_kind: 'member',
            target_id: member.id,
            family_id: family.id,
            details: { from: admin.id },
          }),
      };
    },
  },
  ...(['member.removed', 'member.left'] as const).map((action): AuditCase => ({
    action,
    arrange: async (context) => {
      const { admin, member, family } = await familyWithMember(context);
      const by = action === 'member.removed' ? admin : member;
      return {
        act: () => as(context.target, by).delete(`/api/families/${family.id}/members/${member.id}`),
        status: 204,
        expected: () =>
          byParent(context.databaseUrl, by.id, {
            action,
            target_kind: 'member',
            target_id: member.id,
            family_id: family.id,
            details: {},
          }),
      };
    },
  })),
  {
    action: 'join_request.created',
    arrange: async (context) => {
      const { family } = await newFamily(context);
      const applicant = await newParent(context);
      return {
        act: () => as(context.target, applicant).post('/api/join-requests', { code: family.code }),
        status: 201,
        expected: (response) =>
          byParent(context.databaseUrl, applicant.id, {
            action: 'join_request.created',
            target_kind: 'join_request',
            target_id: applicantJoinRequestSchema.parse(response.body).id,
            family_id: family.id,
            details: {},
          }),
      };
    },
  },
  {
    action: 'join_request.withdrawn',
    arrange: async (context) => {
      const { family, applicant, requestId } = await pendingRequest(context);
      return {
        act: () => as(context.target, applicant).delete(`/api/join-requests/${requestId}`),
        status: 204,
        expected: () =>
          byParent(context.databaseUrl, applicant.id, {
            action: 'join_request.withdrawn',
            target_kind: 'join_request',
            target_id: requestId,
            family_id: family.id,
            details: {},
          }),
      };
    },
  },
  {
    action: 'join_request.dismissed',
    arrange: async (context) => {
      const { admin, family, applicant, requestId } = await pendingRequest(context);
      await as(context.target, admin)
        .post(`/api/families/${family.id}/join-requests/${requestId}/reject`)
        .expect(200);
      return {
        act: () => as(context.target, applicant).post(`/api/join-requests/${requestId}/dismiss`),
        status: 204,
        expected: () =>
          byParent(context.databaseUrl, applicant.id, {
            action: 'join_request.dismissed',
            target_kind: 'join_request',
            target_id: requestId,
            family_id: family.id,
            details: {},
          }),
      };
    },
  },
  decisionCase('approve'),
  decisionCase('reject'),
  {
    action: 'child.created',
    arrange: async (context) => {
      const { admin, family } = await newFamily(context);
      return {
        act: () =>
          as(context.target, admin).post(childrenPath(family.id), {
            nickname: context.personal.nickname(),
            account: context.personal.account(),
            consent: true,
          }),
        status: 201,
        expected: (response) =>
          byParent(context.databaseUrl, admin.id, {
            action: 'child.created',
            target_kind: 'child',
            target_id: (response.body as { id: string }).id,
            family_id: family.id,
            details: { consentVersion: CHILD_CONSENT_VERSION },
          }),
      };
    },
  },
  childCase('child.updated', (context, parent, path) => ({
    act: () =>
      as(context.target, parent).patch(path, {
        nickname: context.personal.nickname(),
        account: context.personal.account(),
      }),
    status: 200,
    details: { fields: ['nickname', 'account'] },
  })),
  {
    action: 'child.updated',
    arrange: async (context) => {
      const { admin, family, child } = await familyWithChild(context);
      const { browser } = await signInWithNewPassword(context.target, admin, family.id, child.id);
      return {
        act: () => browser.rename({ nickname: context.personal.nickname() }),
        status: 200,
        expected: () =>
          byChild(child.id, {
            action: 'child.updated',
            target_kind: 'child',
            target_id: child.id,
            family_id: family.id,
            details: { fields: ['nickname'] },
          }),
      };
    },
  },
  childCase('child.deleted', (context, parent, path) => ({
    act: () => as(context.target, parent).delete(path),
    status: 204,
  })),
  childCase('child.password_reset', (context, parent, path) => ({
    act: () => as(context.target, parent).post(`${path}/password-reset`),
    status: 204,
  })),
  childCase('child.login_link_created', (context, parent, path) => ({
    act: () => as(context.target, parent).post(`${path}/login-links`),
    status: 201,
  })),
  {
    action: 'child.password_set',
    arrange: async (context) => {
      const { admin, family, child } = await familyWithChild(context);
      const { token } = await newLoginLink(context.target, admin, family.id, child.id);
      return {
        act: () =>
          new ChildBrowser(context.target).post(`${linkPath(token)}/password`, {
            password: 'secret1',
            remember: false,
          }),
        status: 200,
        expected: () =>
          byChild(child.id, {
            action: 'child.password_set',
            target_kind: 'child',
            target_id: child.id,
            family_id: family.id,
            details: { via: 'qr' },
          }),
      };
    },
  },
  ...(['one', 'all'] as const).map((revoked): AuditCase => ({
    action: 'child.devices_revoked',
    arrange: async (context) => {
      const { admin, family, child, deviceId } = await familyWithDevice(context);
      const devices = `${childPath(family.id, child.id)}/devices`;
      return {
        act: () =>
          as(context.target, admin).delete(revoked === 'one' ? `${devices}/${deviceId}` : devices),
        status: 204,
        expected: () =>
          byParent(context.databaseUrl, admin.id, {
            action: 'child.devices_revoked',
            target_kind: 'child',
            target_id: child.id,
            family_id: family.id,
            details: revoked === 'one' ? { deviceId } : {},
          }),
      };
    },
  })),
  ...(['book.acquired', 'book.removed'] as const).map((action): AuditCase => ({
    action,
    arrange: async (context) => {
      const { admin, family } = await newFamily(context);
      const path = acquisitionPath(family.id, ACTIVE_BOOK);
      if (action === 'book.removed') {
        await acquire(context.target, admin, family.id, ACTIVE_BOOK);
      }
      return {
        act: () =>
          action === 'book.acquired'
            ? as(context.target, admin).put(path, {})
            : as(context.target, admin).delete(path),
        status: action === 'book.acquired' ? 200 : 204,
        expected: () =>
          byParent(context.databaseUrl, admin.id, {
            action,
            target_kind: 'book',
            target_id: ACTIVE_BOOK,
            family_id: family.id,
            details: {},
          }),
      };
    },
  })),
  {
    action: 'book.readers_changed',
    arrange: async (context) => {
      const { admin, family, child } = await familyWithChild(context);
      const other = await addChild(context.target, admin, family.id, {
        nickname: context.personal.nickname(),
        account: context.personal.account(),
      });
      await acquire(context.target, admin, family.id, ACTIVE_BOOK);
      await setReaders(context.target, admin, { familyId: family.id, bookId: ACTIVE_BOOK }, [
        child.id,
      ]);
      return {
        act: () =>
          as(context.target, admin).put(readersPath(family.id, ACTIVE_BOOK), {
            childIds: [other.id],
          }),
        status: 200,
        expected: () =>
          byParent(context.databaseUrl, admin.id, {
            action: 'book.readers_changed',
            target_kind: 'book',
            target_id: ACTIVE_BOOK,
            family_id: family.id,
            details: { added: [other.id], removed: [child.id] },
          }),
      };
    },
  },
];
