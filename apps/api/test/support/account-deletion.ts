import { errorResponseSchema } from '@thinklet/contracts';
import request from 'supertest';
import {
  businessSnapshot,
  type AuditCase,
  type AuditContext,
  type AuditRow,
  type ExpectedAudit,
} from './audit.js';
import { STUB_USER_DELETED_EVENT, STUB_WEBHOOK_SECRET_HEADER } from './authing-stub.js';
import { TEST_AUTHING } from './containers.js';
import { query } from './database.js';
import { as, createFamily, signInParent, type Parent, type RunningApp } from './families.js';
import type { Target } from './login.js';

// Helpers for tests of deleting parents' accounts: the parent's own
// deletion, Authing's notification of users deleted in its console, what
// the database keeps of a parent, and the audit cases of both deletions.

/** The path of Authing's webhook on the api. */
export const WEBHOOK_PATH = '/api/webhooks/authing';

/** What a deleted parent leaves in the tables: no row of their own, no membership, no join request. */
export const NO_ROWS_OF_PARENT = { parents: 0, memberships: 0, joinRequests: 0 } as const;

/** `DELETE /api/me` as the parent, as the web app sends it. */
export function deleteOwnAccount(target: Target, parent: Parent) {
  return as(target, parent).delete('/api/me');
}

/** The body of Authing's `user:deleted` notification for the users, as the stand-in sends it. */
export function userDeletedNotification(userIds: readonly string[]) {
  return {
    eventName: STUB_USER_DELETED_EVENT,
    data: { users: userIds.map((userId) => ({ userId })) },
  };
}

/**
 * Sends a notification to the webhook as Authing does: with no Origin and
 * the webhook secret in its header, unless a test gives another secret or
 * none.
 */
export function notify(
  target: Target,
  body: object,
  secret: string | null = TEST_AUTHING.webhookSecret,
) {
  const call = request(target).post(WEBHOOK_PATH);
  return (secret === null ? call : call.set(STUB_WEBHOOK_SECRET_HEADER, secret)).send(body);
}

/** The parent's subject at the identity provider, the user id Authing knows them by. */
export async function subjectOf(databaseUrl: string, parentId: string): Promise<string> {
  const [row] = await query<{ oidc_subject: string }>(
    databaseUrl,
    'select oidc_subject from parents where id = $1',
    [parentId],
  );
  if (row === undefined) {
    throw new Error(`No parent ${parentId}`);
  }
  return row.oidc_subject;
}

/** How many rows of the parent each table keeps: their own, their memberships and their join requests. */
export async function rowsOfParent(
  databaseUrl: string,
  parentId: string,
): Promise<{ parents: number; memberships: number; joinRequests: number }> {
  const [row] = await query<{ parents: number; memberships: number; join_requests: number }>(
    databaseUrl,
    `select
       (select count(*)::int from parents where id = $1) as parents,
       (select count(*)::int from family_members where parent_id = $1) as memberships,
       (select count(*)::int from join_requests where parent_id = $1) as join_requests`,
    [parentId],
  );
  return {
    parents: row?.parents ?? 0,
    memberships: row?.memberships ?? 0,
    joinRequests: row?.join_requests ?? 0,
  };
}

/**
 * Sends, as `send` does, a notification of the deletion of a new parent
 * who runs a family, and expects it refused with 401 `unauthenticated`
 * and nothing changed, in the database or in Redis. `send` gets the
 * parent's subject and the parent, signed in.
 */
export async function expectNotificationRefused(
  running: RunningApp,
  send: (subject: string, parent: Parent) => PromiseLike<request.Response>,
): Promise<void> {
  const parent = await signInParent(running.server);
  await createFamily(running.server, parent);
  const subject = await subjectOf(running.databaseUrl, parent.id);
  const snapshot = () => businessSnapshot(running.databaseUrl, running.redisUrl);
  const before = await snapshot();

  const response = await send(subject, parent);

  expect(response.status).toBe(401);
  expect(errorResponseSchema.parse(response.body).error.code).toBe('unauthenticated');
  expect(await snapshot()).toEqual(before);
}

/**
 * The audit rows as a test expects them: without the id and the time the
 * database gave them, in the order of their actions. Rows of one
 * transaction share its time, so the order they were written in is not
 * kept.
 */
export function storedByAction(rows: readonly AuditRow[]): ExpectedAudit[] {
  return [...rows]
    .sort((a, b) => a.action.localeCompare(b.action))
    .map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).filter(([column]) => column !== 'id' && column !== 'occurred_at'),
        ) as ExpectedAudit,
    );
}

/** The audit row of a parent's deletion, by the parent themself or by the site itself. */
function parentDeleted(
  parent: Parent,
  via: 'self' | 'webhook',
  identity: { issuer: string; subject: string },
): ExpectedAudit {
  const row = {
    action: 'parent.deleted',
    target_kind: 'parent',
    target_id: parent.id,
    family_id: null,
    details: { via },
  };
  return via === 'self'
    ? {
        actor_kind: 'parent',
        actor_id: parent.id,
        actor_issuer: identity.issuer,
        actor_subject: identity.subject,
        ...row,
      }
    : { actor_kind: 'system', actor_id: null, actor_issuer: null, actor_subject: null, ...row };
}

/** A parent of no family, signed in with personal data of their own, with their Authing identity. */
async function parentWithoutFamily({ target, databaseUrl, personal }: AuditContext) {
  const parent = await signInParent(target, personal.parentClaims());
  const [identity] = await query<{ issuer: string; subject: string }>(
    databaseUrl,
    'select oidc_issuer as issuer, oidc_subject as subject from parents where id = $1',
    [parent.id],
  );
  if (identity === undefined) {
    throw new Error(`No parent ${parent.id}`);
  }
  return { parent, identity };
}

/**
 * The audit cases of deleting a parent of no family: their own deletion,
 * recorded as theirs, and Authing's notification of their deletion in its
 * console, recorded as the site's.
 */
export const ACCOUNT_DELETION_AUDIT_CASES: AuditCase[] = (['self', 'webhook'] as const).map(
  (via): AuditCase => ({
    action: 'parent.deleted',
    arrange: async (context) => {
      const { parent, identity } = await parentWithoutFamily(context);
      return {
        act: () =>
          via === 'self'
            ? deleteOwnAccount(context.target, parent)
            : notify(context.target, userDeletedNotification([identity.subject])),
        status: via === 'self' ? 204 : 200,
        expected: () => Promise.resolve(parentDeleted(parent, via, identity)),
      };
    },
  }),
);
