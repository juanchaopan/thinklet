import { deleteOwnAccount, notify, userDeletedNotification } from '../support/account-deletion.js';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { TEST_AUTHING } from '../support/containers.js';
import { query } from '../support/database.js';
import { createFamily, signInParent } from '../support/families.js';

/** The personal data of the parents whose accounts are deleted, each value its own. */
const PERSONAL = {
  name: '周子航logs',
  email: 'zihang.logs@example.com',
  familyName: '林悦的家logs',
};

/** The subject of the parent at the identity provider, read from the database. */
async function subjectOf(databaseUrl: string, parentId: string): Promise<string> {
  const [row] = await query<{ oidc_subject: string }>(
    databaseUrl,
    'select oidc_subject from parents where id = $1',
    [parentId],
  );
  return row?.oidc_subject ?? '';
}

/**
 * Deletes accounts every way the api knows on the running api: a parent's
 * own deletion that Authing refuses, then one it takes, Authing's
 * notifications with a wrong secret and with the right one; then stops the
 * api and answers everything it wrote.
 */
async function logsOfDeletions(started: BuiltAppWithServices): Promise<string> {
  const { api, authing, services } = started;
  const databaseUrl = services.database.getConnectionUri();
  const parent = await signInParent(api, { name: PERSONAL.name, email: PERSONAL.email });
  const admin = await signInParent(api, { name: PERSONAL.name, email: PERSONAL.email });
  await createFamily(api, admin, { name: PERSONAL.familyName, timezone: 'Asia/Shanghai' });
  const adminSubject = await subjectOf(databaseUrl, admin.id);

  authing.failDeletions('error');
  const refused = await deleteOwnAccount(api, parent);
  authing.failDeletions(undefined);
  const deleted = await deleteOwnAccount(api, parent);
  const reports = await authing.deliverReports();
  const forged = await notify(api, userDeletedNotification([adminSubject]), 'forged-secret');
  const reported = await notify(api, userDeletedNotification([adminSubject]));

  expect([refused.status, deleted.status, forged.status, reported.status]).toEqual([
    502, 204, 401, 200,
  ]);
  expect(reports.map(({ status }) => status)).toEqual([200]);
  return started.stopApp();
}

// Deleting accounts goes through Authing's management API with the user
// pool's secret and a management token, and Authing's webhook proves
// itself with its secret: none of the three is ever logged, nor the
// deleted parents' personal data. A failure of Authing is logged with its
// status and codes. The built api runs as a separate process and
// everything it writes is read, as the platform's log collector would.
describe('Logs of deleting accounts', () => {
  let started: BuiltAppWithServices | undefined;
  let written = '';

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    written = await logsOfDeletions(started);
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('hold the requests and the failure of Authing with its status', () => {
    expect(written).toContain('/api/me');
    expect(written).toContain('/api/webhooks/authing');
    expect(written).toContain("Authing's management API failed");
    expect(written).toContain('status 500');
  });

  it('hold no secret of Authing and no management token', () => {
    const tokens = started?.authing.issuedTokens ?? [];

    expect(tokens.length).toBeGreaterThan(0);
    for (const secret of [
      TEST_AUTHING.userPoolSecret,
      TEST_AUTHING.webhookSecret,
      'forged-secret',
      ...tokens,
    ]) {
      expect(written).not.toContain(secret);
    }
  });

  it("hold none of the deleted parents' personal data", () => {
    for (const value of Object.values(PERSONAL)) {
      expect(written).not.toContain(value);
    }
  });
});
