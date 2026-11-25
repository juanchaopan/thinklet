import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { newLoginLink } from '../support/child-login.js';
import { addChild, newAccount } from '../support/children.js';
import { query } from '../support/database.js';
import { addMember, createFamily, signInParent } from '../support/families.js';
import { deleteFamily } from '../support/family-deletion.js';

/** The personal data of the family deleted and of its child, each value its own. */
const PERSONAL = {
  familyName: '林悦的家logs',
  nickname: '豆豆logs',
  account: newAccount(),
};

/**
 * Deletes a family on the running api after a member who is not its admin
 * and a parent of another family were refused, then stops the api and
 * answers everything it wrote.
 */
async function logsOfDeletion(started: BuiltAppWithServices): Promise<string> {
  const { api, services } = started;
  const admin = await signInParent(api);
  const family = await createFamily(api, admin, {
    name: PERSONAL.familyName,
    timezone: 'Asia/Shanghai',
  });
  const member = await signInParent(api);
  await addMember(services.database.getConnectionUri(), family.id, member.id);
  const stranger = await signInParent(api);
  const child = await addChild(api, admin, family.id, {
    nickname: PERSONAL.nickname,
    account: PERSONAL.account,
  });
  await newLoginLink(api, admin, family.id, child.id);

  const refused = await deleteFamily(api, member, family.id);
  const hidden = await deleteFamily(api, stranger, family.id);
  const deleted = await deleteFamily(api, admin, family.id);

  expect([refused.status, hidden.status, deleted.status]).toEqual([403, 404, 204]);
  const [left] = await query<{ count: number }>(
    services.database.getConnectionUri(),
    'select count(*)::int as count from families where id = $1',
    [family.id],
  );
  expect(left?.count).toBe(0);
  return started.stopApp();
}

// A family's name is not logged (`.docs/design/data.md`), nor its
// children's nicknames and accounts: deleting a family, and the refusals
// of a parent who may not, log the request and none of them. The built
// api runs as a separate process and everything it writes is read, as the
// platform's log collector would.
describe('Logs of deleting a family', () => {
  let started: BuiltAppWithServices | undefined;
  let written = '';

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    written = await logsOfDeletion(started);
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('hold the requests', () => {
    expect(written).toContain('/api/families/');
  });

  it("hold neither the family's name nor its child's nickname and account", () => {
    for (const value of Object.values(PERSONAL)) {
      expect(written).not.toContain(value);
    }
  });
});
