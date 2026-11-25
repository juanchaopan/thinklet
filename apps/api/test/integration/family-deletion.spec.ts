import { errorResponseSchema, rememberedChildListSchema } from '@thinklet/contracts';
import { rowsOfParent, storedByAction } from '../support/account-deletion.js';
import { businessSnapshot, rowsAddedBy } from '../support/audit.js';
import { addChildWithPassword, ChildBrowser } from '../support/child-login.js';
import { query } from '../support/database.js';
import {
  addMember,
  as,
  createFamily,
  memberRows,
  signInParent,
  useAppWithServices,
} from '../support/families.js';
import {
  deleteFamily,
  familyFullOfData,
  NO_ROWS_OF_FAMILY,
  rowsOfFamily,
} from '../support/family-deletion.js';
import { redisContents } from '../support/login-links.js';

// Acceptance criterion covered (#14, 27, deleting a family): the admin
// deletes the family, also while it has other parents. Its children with
// their remembered devices, assigned books and login links in Redis, the
// books it acquired, its join requests and every parent's membership go
// in one transaction, recorded as `family.deleted` by the admin; the
// parents' accounts and their other families stay, and so do the family's
// earlier audit rows. A member who is not the admin is 403 `not_admin`, a
// parent who is not a member 404 `family_not_found`, and neither deletes
// anything. A child of the family signed in is signed out at its next
// request, and its remembered avatar is gone.
describe('DELETE /api/families/{familyId}', () => {
  const running = useAppWithServices();
  const snapshot = () => businessSnapshot(running.databaseUrl, running.redisUrl);

  /** How many audit rows of the family there are, its deletion's left out. */
  async function auditRowsOfFamily(familyId: string): Promise<number> {
    const [row] = await query<{ count: number }>(
      running.databaseUrl,
      "select count(*)::int as count from audit_events where family_id = $1 and action <> 'family.deleted'",
      [familyId],
    );
    return row?.count ?? 0;
  }

  /** A family full of data with 周子航, a member who runs a family of his own. */
  async function familyWithOtherParent() {
    const data = await familyFullOfData(running);
    const member = await signInParent(running.server, { name: '周子航' });
    await addMember(running.databaseUrl, data.family.id, member.id);
    const memberFamily = await createFamily(running.server, member, {
      name: '周家',
      timezone: 'Asia/Shanghai',
    });
    return { ...data, member, memberFamily };
  }

  it('deletes the family with everything in it while it has other parents, who stay', async () => {
    const { admin, family, applicant, doudou, link, otherFamily, member, memberFamily } =
      await familyWithOtherParent();
    const auditBefore = await auditRowsOfFamily(family.id);

    const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
      deleteFamily(running.server, admin, family.id),
    );

    expect(response.status).toBe(204);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await rowsOfFamily(running.databaseUrl, family.id)).toEqual(NO_ROWS_OF_FAMILY);
    const keys = (await redisContents(running.redisUrl)).map(({ key }) => key);
    expect(keys.filter((key) => key.includes(doudou.id) || key.includes(link.id))).toEqual([]);
    for (const parent of [admin, member, applicant]) {
      expect((await rowsOfParent(running.databaseUrl, parent.id)).parents).toBe(1);
    }
    expect(await memberRows(running.databaseUrl, memberFamily.id)).toEqual([
      { parent_id: member.id, role: 'admin' },
    ]);
    expect(
      (await memberRows(running.databaseUrl, otherFamily.id)).map(({ parent_id }) => parent_id),
    ).toContain(admin.id);
    expect(storedByAction(added)).toEqual([
      {
        actor_kind: 'parent',
        actor_id: admin.id,
        actor_issuer: expect.any(String) as string,
        actor_subject: expect.any(String) as string,
        action: 'family.deleted',
        target_kind: 'family',
        target_id: family.id,
        family_id: family.id,
        details: { children: 2, members: 2 },
      },
    ]);
    expect(auditBefore).toBeGreaterThan(0);
    expect(await auditRowsOfFamily(family.id)).toBe(auditBefore);
  });

  it('leaves the other parents signed in, finding the family gone', async () => {
    const { admin, family, member } = await familyWithOtherParent();

    await deleteFamily(running.server, admin, family.id).expect(204);

    const read = await as(running.server, member).get(`/api/families/${family.id}`);
    expect(read.status).toBe(404);
    expect(errorResponseSchema.parse(read.body).error.code).toBe('family_not_found');
    const me = await as(running.server, member).get('/api/me').expect(200);
    expect((me.body as { families: Array<{ name: string }> }).families).toEqual([
      expect.objectContaining({ name: '周家' }),
    ]);
  });

  it('refuses a member who is not the admin with 403 not_admin, deleting nothing', async () => {
    const { family, member } = await familyWithOtherParent();
    const before = await snapshot();

    const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
      deleteFamily(running.server, member, family.id),
    );

    expect(response.status).toBe(403);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('not_admin');
    expect(added).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('answers a parent who is not a member with 404 family_not_found, deleting nothing', async () => {
    const { family } = await familyFullOfData(running);
    const stranger = await signInParent(running.server);
    await createFamily(running.server, stranger, { name: '周家', timezone: 'Asia/Shanghai' });
    const before = await snapshot();

    const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
      deleteFamily(running.server, stranger, family.id),
    );

    expect(response.status).toBe(404);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('family_not_found');
    expect(added).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('answers a family already deleted, or no family at all, with 404 family_not_found', async () => {
    const admin = await signInParent(running.server);
    const family = await createFamily(running.server, admin);
    await deleteFamily(running.server, admin, family.id).expect(204);

    const responses = [
      await deleteFamily(running.server, admin, family.id),
      await deleteFamily(running.server, admin, crypto.randomUUID()),
      await deleteFamily(running.server, admin, 'not-an-id'),
    ];

    expect(
      responses.map(({ status, body }) => [status, errorResponseSchema.parse(body).error.code]),
    ).toEqual(responses.map(() => [404, 'family_not_found']));
  });

  it("signs a child of the family out at its next request and forgets the child's avatar", async () => {
    const admin = await signInParent(running.server);
    const family = await createFamily(running.server, admin);
    const child = await addChildWithPassword(running.server, admin, family.id);
    const kid = new ChildBrowser(running.server);
    const login = await kid.login({
      code: family.code,
      account: child.account,
      password: child.password,
      remember: true,
    });
    expect(login.status).toBe(200);

    await deleteFamily(running.server, admin, family.id).expect(204);

    expect((await kid.me()).status).toBe(401);
    const remembered = await kid.get('/api/child-auth/remembered');
    expect(remembered.status).toBe(200);
    expect(rememberedChildListSchema.parse(remembered.body)).toEqual([]);
  });
});
