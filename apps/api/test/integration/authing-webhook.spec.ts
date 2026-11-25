import { errorResponseSchema } from '@thinklet/contracts';
import { AUTHING_WEBHOOK_SECRET_HEADER } from '../../src/infrastructure/identity-provider/authing-webhook.guard.js';
import {
  expectNotificationRefused,
  NO_ROWS_OF_PARENT,
  notify,
  rowsOfParent,
  storedByAction,
  subjectOf,
  userDeletedNotification,
} from '../support/account-deletion.js';
import { businessSnapshot, rowsAddedBy, type AuditRow } from '../support/audit.js';
import { STUB_WEBHOOK_SECRET_HEADER } from '../support/authing-stub.js';
import { TEST_AUTHING } from '../support/containers.js';
import {
  addMember,
  createFamily,
  memberRows,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { familyFullOfData, NO_ROWS_OF_FAMILY, rowsOfFamily } from '../support/family-deletion.js';
import { redisContents } from '../support/login-links.js';

/** The actor columns of what the site itself does. */
const BY_SYSTEM = { actor_kind: 'system', actor_id: null, actor_issuer: null, actor_subject: null };

// Acceptance criterion covered (#14, 27, parents deleted in Authing's
// console): Authing's `user:deleted` notification, proven by the webhook
// secret alone, deletes the reported parents here. A family they ran with
// other parents passes to the one who joined first; one they were the only
// parent of is deleted with its children, devices, books, assignments,
// join requests and the children's login links in Redis. A parent not
// found, a second notification and any other event change nothing.
describe('POST /api/webhooks/authing', () => {
  const running = useAppWithServices();
  const snapshot = () => businessSnapshot(running.databaseUrl, running.redisUrl);

  /**
   * Deletes the parent as the platform team does in Authing's console;
   * Authing's report arrives and is taken, and nothing of the parent is
   * left. Answers the audit rows the report added.
   */
  async function deleteInConsole(parent: Parent): Promise<AuditRow[]> {
    const subject = await subjectOf(running.databaseUrl, parent.id);
    const { result: delivered, added } = await rowsAddedBy(running.databaseUrl, () => {
      running.authing.deleteInConsole([subject]);
      return running.authing.deliverReports();
    });
    expect(delivered.map(({ status }) => status)).toEqual([200]);
    expect(await rowsOfParent(running.databaseUrl, parent.id)).toEqual(NO_ROWS_OF_PARENT);
    return added;
  }

  it('reads the secret from the header the stand-in sends it in', () => {
    expect(STUB_WEBHOOK_SECRET_HEADER).toBe(AUTHING_WEBHOOK_SECRET_HEADER);
  });

  it.each([
    ['without the secret', null],
    ['with a wrong secret', `${TEST_AUTHING.webhookSecret}x`],
    ['with an empty secret', ''],
  ])('refuses a notification %s with 401 and deletes no one', async (_case, secret) => {
    await expectNotificationRefused(running, (subject) =>
      notify(running.server, userDeletedNotification([subject]), secret),
    );
  });

  it('hands a family over to the other parent who joined first when its admin is deleted', async () => {
    const admin = await signInParent(running.server);
    const family = await createFamily(running.server, admin);
    const first = await signInParent(running.server);
    const second = await signInParent(running.server);
    await addMember(running.databaseUrl, family.id, first.id);
    await addMember(running.databaseUrl, family.id, second.id);

    const added = await deleteInConsole(admin);

    expect(await memberRows(running.databaseUrl, family.id)).toEqual([
      { parent_id: first.id, role: 'admin' },
      { parent_id: second.id, role: 'member' },
    ]);
    expect(storedByAction(added)).toEqual([
      {
        ...BY_SYSTEM,
        action: 'member.admin_transferred',
        target_kind: 'member',
        target_id: first.id,
        family_id: family.id,
        details: { from: admin.id },
      },
      {
        ...BY_SYSTEM,
        action: 'parent.deleted',
        target_kind: 'parent',
        target_id: admin.id,
        family_id: null,
        details: { via: 'webhook' },
      },
    ]);
  });

  it('deletes a family whose only parent is deleted, with everything in it', async () => {
    const { admin, family, applicant, doudou, link, otherFamily } = await familyFullOfData(running);

    const added = await deleteInConsole(admin);

    expect(await rowsOfFamily(running.databaseUrl, family.id)).toEqual(NO_ROWS_OF_FAMILY);
    expect((await rowsOfParent(running.databaseUrl, applicant.id)).parents).toBe(1);
    expect((await rowsOfFamily(running.databaseUrl, otherFamily.id))?.['members']).toBe(1);
    const keys = (await redisContents(running.redisUrl)).map(({ key }) => key);
    expect(keys.filter((key) => key.includes(doudou.id) || key.includes(link.id))).toEqual([]);
    expect(storedByAction(added)).toEqual([
      {
        ...BY_SYSTEM,
        action: 'family.deleted',
        target_kind: 'family',
        target_id: family.id,
        family_id: family.id,
        details: { children: 2, members: 1 },
      },
      {
        ...BY_SYSTEM,
        action: 'parent.deleted',
        target_kind: 'parent',
        target_id: admin.id,
        family_id: null,
        details: { via: 'webhook' },
      },
    ]);
  });

  it('changes nothing when the same notification comes again', async () => {
    const admin = await signInParent(running.server);
    await createFamily(running.server, admin);
    const subject = await subjectOf(running.databaseUrl, admin.id);
    const notification = userDeletedNotification([subject]);
    await notify(running.server, notification).expect(200);
    const before = await snapshot();

    const { result: again, added } = await rowsAddedBy(running.databaseUrl, () =>
      notify(running.server, notification),
    );

    expect(again.status).toBe(200);
    expect(added).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('passes over a user who is no parent here and deletes the others reported with them', async () => {
    const parent = await signInParent(running.server);
    const subject = await subjectOf(running.databaseUrl, parent.id);

    const response = await notify(
      running.server,
      userDeletedNotification([`unknown-${crypto.randomUUID()}`, subject]),
    );

    expect(response.status).toBe(200);
    expect((await rowsOfParent(running.databaseUrl, parent.id)).parents).toBe(0);
  });

  it('changes nothing for a user no parent here has', async () => {
    const before = await snapshot();

    const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
      notify(running.server, userDeletedNotification([`unknown-${crypto.randomUUID()}`])),
    );

    expect(response.status).toBe(200);
    expect(added).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['user:updated', 'login', 'register'])(
    'answers %s with 200 and changes nothing',
    async (eventName) => {
      const parent = await signInParent(running.server);
      const subject = await subjectOf(running.databaseUrl, parent.id);
      const before = await snapshot();

      const response = await notify(running.server, {
        eventName,
        data: { users: [{ userId: subject }], user: { id: subject } },
      });

      expect(response.status).toBe(200);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    ['without an event name', { data: {} }],
    ['of user:deleted without its users', { eventName: 'user:deleted', data: {} }],
  ])('refuses a notification %s with 400', async (_case, body) => {
    const response = await notify(running.server, body);

    expect(response.status).toBe(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('invalid_request');
  });

  it("needs neither a login nor this site's Origin", async () => {
    const parent = await signInParent(running.server);
    const subject = await subjectOf(running.databaseUrl, parent.id);

    const response = await notify(running.server, userDeletedNotification([subject])).set(
      'Origin',
      'https://events.authing.example',
    );

    expect(response.status).toBe(200);
    expect((await rowsOfParent(running.databaseUrl, parent.id)).parents).toBe(0);
  });
});
