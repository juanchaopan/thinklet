import type { AuditCase, AuditContext, ExpectedAudit } from './audit.js';
import { acquire, ACTIVE_BOOK, setReaders } from './books.js';
import { newLoginLink } from './child-login.js';
import { addChild, insertDevice } from './children.js';
import { query } from './database.js';
import {
  addMember,
  addPendingRequest,
  as,
  createFamily,
  signInParent,
  type Parent,
  type RunningApp,
} from './families.js';
import type { Target } from './login.js';

// Helpers for tests of deleting a family, by its admin or with the only
// parent Authing reports deleted: a family with every kind of data a
// family holds, how many rows of each table are left of it, and the audit
// case of the admin's deletion.

/** The rows a deleted family leaves in each of its tables: none. */
export const NO_ROWS_OF_FAMILY = {
  families: 0,
  members: 0,
  join_requests: 0,
  children: 0,
  devices: 0,
  family_books: 0,
  assignments: 0,
};

/** How many rows of each table belong to the family. */
export async function rowsOfFamily(
  databaseUrl: string,
  familyId: string,
): Promise<Record<string, number> | undefined> {
  const [row] = await query<Record<string, number>>(
    databaseUrl,
    `select
       (select count(*)::int from families where id = $1) as families,
       (select count(*)::int from family_members where family_id = $1) as members,
       (select count(*)::int from join_requests where family_id = $1) as join_requests,
       (select count(*)::int from children where family_id = $1) as children,
       (select count(*)::int from child_devices d join children c on c.id = d.child_id
         where c.family_id = $1) as devices,
       (select count(*)::int from family_books where family_id = $1) as family_books,
       (select count(*)::int from book_assignments where family_id = $1) as assignments`,
    [familyId],
  );
  return row;
}

/** `DELETE /api/families/{familyId}` as the parent, as the web app sends it. */
export function deleteFamily(target: Target, parent: Parent, familyId: string) {
  return as(target, parent).delete(`/api/families/${familyId}`);
}

/**
 * A family of a new admin with every kind of data a family holds: a
 * pending request of an applicant, 小米 remembered on a browser and
 * reading a book the family acquired, and 豆豆 with a login link in Redis.
 * The admin is also a member of 外婆家, another parent's family.
 */
export async function familyFullOfData({ server, databaseUrl }: RunningApp) {
  const admin = await signInParent(server);
  const family = await createFamily(server, admin);
  const applicant = await signInParent(server);
  await addPendingRequest(databaseUrl, family, applicant.id);
  const xiaomi = await addChild(server, admin, family.id, { nickname: '小米' });
  const doudou = await addChild(server, admin, family.id, { nickname: '豆豆' });
  await insertDevice(databaseUrl, xiaomi.id, {
    name: 'iPad · Safari',
    rememberedAt: new Date(),
    lastUsedAt: new Date(),
  });
  await acquire(server, admin, family.id, ACTIVE_BOOK);
  await setReaders(server, admin, { familyId: family.id, bookId: ACTIVE_BOOK }, [xiaomi.id]);
  const link = await newLoginLink(server, admin, family.id, doudou.id);
  const otherFamily = await createFamily(server, await signInParent(server), {
    name: '外婆家',
    timezone: 'Asia/Shanghai',
  });
  await addMember(databaseUrl, otherFamily.id, admin.id);
  return { admin, family, applicant, xiaomi, doudou, link, otherFamily };
}

/** The actor columns of the parent's audit rows, read from the parent's row. */
async function actorColumnsOf(
  databaseUrl: string,
  parentId: string,
): Promise<Pick<ExpectedAudit, 'actor_kind' | 'actor_id' | 'actor_issuer' | 'actor_subject'>> {
  const [actor] = await query<
    Pick<ExpectedAudit, 'actor_kind' | 'actor_id' | 'actor_issuer' | 'actor_subject'>
  >(
    databaseUrl,
    `select 'parent' as actor_kind, id as actor_id,
       oidc_issuer as actor_issuer, oidc_subject as actor_subject
     from parents where id = $1`,
    [parentId],
  );
  if (actor === undefined) {
    throw new Error(`No parent ${parentId}`);
  }
  return actor;
}

/**
 * The audit case of an admin deleting a family named with personal data,
 * with a child named with personal data holding a login link in Redis and
 * another parent, who stays: one `family.deleted` row by the admin, with
 * how many children and members went.
 */
export const FAMILY_DELETION_AUDIT_CASES: AuditCase[] = [
  {
    action: 'family.deleted',
    arrange: async ({ target, databaseUrl, personal }: AuditContext) => {
      const admin = await signInParent(target, personal.parentClaims());
      const family = await createFamily(target, admin, {
        name: personal.familyName(),
        timezone: 'Asia/Shanghai',
      });
      const member = await signInParent(target, personal.parentClaims());
      await addMember(databaseUrl, family.id, member.id);
      const child = await addChild(target, admin, family.id, {
        nickname: personal.nickname(),
        account: personal.account(),
      });
      await newLoginLink(target, admin, family.id, child.id);
      return {
        act: () => deleteFamily(target, admin, family.id),
        status: 204,
        expected: async () => ({
          ...(await actorColumnsOf(databaseUrl, admin.id)),
          action: 'family.deleted',
          target_kind: 'family',
          target_id: family.id,
          family_id: family.id,
          details: { children: 1, members: 2 },
        }),
      };
    },
  },
];
