import { errorResponseSchema } from '@thinklet/contracts';
import request from 'supertest';
import {
  deleteOwnAccount,
  rowsOfParent,
  subjectOf,
  storedByAction,
} from '../support/account-deletion.js';
import { auditRows, businessSnapshot, rowsAddedBy } from '../support/audit.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { query } from '../support/database.js';
import {
  addMember,
  addPendingRequest,
  as,
  createFamily,
  memberRows,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { cookieHeader, expectCleared, setCookiesOf } from '../support/login.js';

// Acceptance criterion covered (#14, 27, a parent's own account): a parent
// who is no family's admin deletes their account; Authing deletes it first,
// and only once it has, their memberships, their join requests and the
// parent go in one transaction, recorded as `parent.deleted` `via: self`,
// and their login ends. A family's admin is refused with `still_admin` and
// the families they run; Authing failing or not answering is
// `identity_provider_failed`; either way nothing is deleted.
describe('DELETE /api/me', () => {
  const running = useAppWithServices();
  const snapshot = () => businessSnapshot(running.databaseUrl, running.redisUrl);

  afterEach(() => {
    running.authing.failDeletions(undefined);
  });

  /** A family of a new admin with the parent as a member, and a pending request of theirs to another family. */
  async function memberWithRequest(parent: Parent) {
    const admin = await signInParent(running.server);
    const family = await createFamily(running.server, admin);
    await addMember(running.databaseUrl, family.id, parent.id);
    const other = await createFamily(running.server, await signInParent(running.server), {
      name: '外婆家',
      timezone: 'Asia/Shanghai',
    });
    await addPendingRequest(running.databaseUrl, other, parent.id);
    return { admin, family };
  }

  /** The subject the parent had, read from the audit row of their deletion. */
  async function subjectOfDeleted(parent: Parent): Promise<string> {
    const [row] = await query<{ actor_subject: string }>(
      running.databaseUrl,
      "select actor_subject from audit_events where action = 'parent.deleted' and target_id = $1",
      [parent.id],
    );
    return row?.actor_subject ?? '';
  }

  it('deletes a member at Authing and here, clears the login and keeps the family', async () => {
    const parent = await signInParent(running.server, { name: '周子航' });
    const { admin, family } = await memberWithRequest(parent);
    const subject = await subjectOf(running.databaseUrl, parent.id);

    const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
      deleteOwnAccount(running.server, parent),
    );

    expect(response.status).toBe(204);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(running.authing.deletedUserIds).toContain(subject);
    expect(await rowsOfParent(running.databaseUrl, parent.id)).toEqual({
      parents: 0,
      memberships: 0,
      joinRequests: 0,
    });
    expect(await memberRows(running.databaseUrl, family.id)).toEqual([
      { parent_id: admin.id, role: 'admin' },
    ]);
    expect(storedByAction(added)).toEqual([
      {
        actor_kind: 'parent',
        actor_id: parent.id,
        actor_issuer: expect.any(String) as string,
        actor_subject: subject,
        action: 'parent.deleted',
        target_kind: 'parent',
        target_id: parent.id,
        family_id: null,
        details: { via: 'self' },
      },
    ]);
    const cookies = setCookiesOf(response);
    expectCleared(cookies['thinklet_session']);
    expectCleared(cookies['thinklet_id_token']);
    expectCleared(cookies['thinklet_login']);
    expect(cookies['thinklet_child_session']).toBeUndefined();
  });

  it('leaves the old login nothing to open', async () => {
    const parent = await signInParent(running.server);
    await deleteOwnAccount(running.server, parent).expect(204);

    const me = await request(running.server)
      .get('/api/me')
      .set('Cookie', cookieHeader(parent.cookies));
    const again = await deleteOwnAccount(running.server, parent);

    expect(me.status).toBe(401);
    expect(errorResponseSchema.parse(me.body).error.code).toBe('unauthenticated');
    expect(again.status).toBe(401);
  });

  it('deletes a parent of no family', async () => {
    const parent = await signInParent(running.server);

    await deleteOwnAccount(running.server, parent).expect(204);

    expect(await rowsOfParent(running.databaseUrl, parent.id)).toEqual({
      parents: 0,
      memberships: 0,
      joinRequests: 0,
    });
  });

  it("finds no one when Authing's notification of the deletion arrives afterwards", async () => {
    const parent = await signInParent(running.server);
    await running.authing.deliverReports();
    await deleteOwnAccount(running.server, parent).expect(204);
    const before = await snapshot();

    const { result: delivered, added } = await rowsAddedBy(running.databaseUrl, () =>
      running.authing.deliverReports(),
    );

    expect(delivered).toEqual([{ userIds: [await subjectOfDeleted(parent)], status: 200 }]);
    expect(added).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a family's admin with still_admin and their families, deleting nothing", async () => {
    const parent = await signInParent(running.server);
    const first = await createFamily(running.server, parent);
    const second = await createFamily(running.server, parent, {
      name: '爷爷奶奶家',
      timezone: 'Asia/Shanghai',
    });
    const deletedAtAuthing = running.authing.deletedUserIds.length;
    const before = await snapshot();

    const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
      deleteOwnAccount(running.server, parent),
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: 'still_admin',
        requestId: response.headers['x-request-id'],
        families: [
          { id: first.id, name: '林悦的家' },
          { id: second.id, name: '爷爷奶奶家' },
        ],
      },
    });
    expect(running.authing.deletedUserIds).toHaveLength(deletedAtAuthing);
    expect(added).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(setCookiesOf(response)['thinklet_session']).toBeUndefined();
  });

  it.each([
    ['answers with an error', 'error'],
    ['does not answer within ten seconds', 'hang'],
  ] as const)(
    'answers identity_provider_failed and deletes nothing when Authing %s',
    async (_case, failure) => {
      const parent = await signInParent(running.server);
      await memberWithRequest(parent);
      running.authing.failDeletions(failure);
      const before = await snapshot();

      const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
        deleteOwnAccount(running.server, parent),
      );

      expect(response.status).toBe(502);
      expect(errorResponseSchema.parse(response.body).error.code).toBe('identity_provider_failed');
      expect(added).toEqual([]);
      expect(await snapshot()).toEqual(before);
      expect(setCookiesOf(response)['thinklet_session']).toBeUndefined();
      await as(running.server, parent).get('/api/me').expect(200);
    },
    30_000,
  );

  it('is refused without a login', async () => {
    const response = await request(running.server).delete('/api/me').set('Origin', TEST_APP_ORIGIN);

    expect(response.status).toBe(401);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('unauthenticated');
  });

  it('keeps the audit rows of the parent', async () => {
    const parent = await signInParent(running.server);
    await as(running.server, parent).patch('/api/me', { name: '悦悦' }).expect(200);

    await deleteOwnAccount(running.server, parent).expect(204);

    const actions = (await auditRows(running.databaseUrl))
      .filter(({ target_id: target }) => target === parent.id)
      .map(({ action }) => action);
    expect(actions).toEqual(['parent.created', 'parent.renamed', 'parent.deleted']);
  });
});
