import { errorResponseSchema } from '@thinklet/contracts';
import request from 'supertest';
import {
  deleteOwnAccount,
  expectNotificationRefused,
  NO_ROWS_OF_PARENT,
  notify,
  rowsOfParent,
  subjectOf,
  userDeletedNotification,
  WEBHOOK_PATH,
} from '../support/account-deletion.js';
import { businessSnapshot } from '../support/audit.js';
import { CHILD_SESSION_COOKIE } from '../support/child-login.js';
import { addChild } from '../support/children.js';
import { TEST_AUTHING } from '../support/containers.js';
import { query } from '../support/database.js';
import {
  addMember,
  as,
  createFamily,
  memberRows,
  signInParent,
  useAppWithServices,
} from '../support/families.js';
import { FOREIGN_ORIGINS, withChildLoginIn } from '../support/routes.js';

// Security cases of deleting accounts (#14, 27): only the signed-in parent
// deletes their own account, from this site's pages; Authing's webhook is
// believed only with its secret, in its own header; a deletion leaves no
// row of the parent behind but their audit rows, and touches no other
// parent's data.
describe('Deleting accounts', () => {
  const running = useAppWithServices();
  const snapshot = () => businessSnapshot(running.databaseUrl, running.redisUrl);

  describe('DELETE /api/me', () => {
    it.each(FOREIGN_ORIGINS)(
      'refuses a deletion %s with 403 bad_origin',
      async (_case, prepare) => {
        const parent = await signInParent(running.server);
        const deletedAtAuthing = running.authing.deletedUserIds.length;

        const response = await prepare(parent)(request(running.server).delete('/api/me'));

        expect(response.status).toBe(403);
        expect(errorResponseSchema.parse(response.body).error.code).toBe('bad_origin');
        expect(running.authing.deletedUserIds).toHaveLength(deletedAtAuthing);
        expect((await rowsOfParent(running.databaseUrl, parent.id)).parents).toBe(1);
      },
    );

    it.each([CHILD_SESSION_COOKIE, 'thinklet_session'])(
      "opens to no child's login in %s",
      async (cookie) => {
        const parent = await signInParent(running.server);
        const family = await createFamily(running.server, parent);
        const child = await addChild(running.server, parent, family.id);
        const prepare = await withChildLoginIn(cookie, child.id);
        const before = await snapshot();

        const response = await prepare(request(running.server).delete('/api/me'));

        expect(response.status).toBe(401);
        expect(await snapshot()).toEqual(before);
      },
    );

    it("deletes only the signed-in parent, leaving the other parents' rows as they were", async () => {
      const admin = await signInParent(running.server);
      const family = await createFamily(running.server, admin);
      const member = await signInParent(running.server);
      const other = await signInParent(running.server);
      await addMember(running.databaseUrl, family.id, member.id);
      await addMember(running.databaseUrl, family.id, other.id);
      const adminBefore = await rowsOfParent(running.databaseUrl, admin.id);
      const otherBefore = await rowsOfParent(running.databaseUrl, other.id);

      await deleteOwnAccount(running.server, member).expect(204);

      expect(await rowsOfParent(running.databaseUrl, admin.id)).toEqual(adminBefore);
      expect(await rowsOfParent(running.databaseUrl, other.id)).toEqual(otherBefore);
      expect(await memberRows(running.databaseUrl, family.id)).toEqual([
        { parent_id: admin.id, role: 'admin' },
        { parent_id: other.id, role: 'member' },
      ]);
      await as(running.server, other).get('/api/me').expect(200);
    });

    it('leaves nothing of the parent but the ids in the audit rows', async () => {
      const parent = await signInParent(running.server, {
        name: '周子航',
        email: 'zihang.zhou@example.com',
      });

      await deleteOwnAccount(running.server, parent).expect(204);

      const [row] = await query<{ text: string }>(
        running.databaseUrl,
        `select coalesce(string_agg(t, ' '), '') as text from (
           select row_to_json(p)::text as t from parents p
           union all select row_to_json(a)::text from audit_events a
         ) rows`,
      );
      expect(row?.text).not.toContain('周子航');
      expect(row?.text).not.toContain('zihang.zhou@example.com');
      expect(await rowsOfParent(running.databaseUrl, parent.id)).toEqual(NO_ROWS_OF_PARENT);
      const audit = await query<{ action: string }>(
        running.databaseUrl,
        "select action from audit_events where target_kind = 'parent' and target_id = $1",
        [parent.id],
      );
      expect(audit.map(({ action }) => action)).toEqual(['parent.created', 'parent.deleted']);
    });
  });

  describe('POST /api/webhooks/authing', () => {
    it.each([
      ['without a secret', {}],
      ['with a wrong secret', { 'x-authing-webhook-secret': 'not-the-webhook-secret' }],
      ['with the secret in another header', { 'x-authing-token': TEST_AUTHING.webhookSecret }],
      ['with the secret as a login', { authorization: `Bearer ${TEST_AUTHING.webhookSecret}` }],
      ['with the user pool secret', { 'x-authing-webhook-secret': TEST_AUTHING.userPoolSecret }],
    ])('refuses a notification %s, deleting no one', async (_case, headers) => {
      await expectNotificationRefused(running, (subject) =>
        request(running.server)
          .post(WEBHOOK_PATH)
          .set(headers)
          .send(userDeletedNotification([subject])),
      );
    });

    it("refuses a parent's own login from this site as proof of a notification", async () => {
      await expectNotificationRefused(running, (subject, parent) =>
        as(running.server, parent).post(WEBHOOK_PATH, userDeletedNotification([subject])),
      );
    });

    it('deletes only the reported parent', async () => {
      const reported = await signInParent(running.server);
      const bystander = await signInParent(running.server);
      const family = await createFamily(running.server, bystander);
      await addMember(running.databaseUrl, family.id, reported.id);
      const bystanderBefore = await rowsOfParent(running.databaseUrl, bystander.id);

      await notify(
        running.server,
        userDeletedNotification([await subjectOf(running.databaseUrl, reported.id)]),
      ).expect(200);

      expect((await rowsOfParent(running.databaseUrl, reported.id)).parents).toBe(0);
      expect(await rowsOfParent(running.databaseUrl, bystander.id)).toEqual(bystanderBefore);
    });
  });
});
