import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { signInWithNewPassword } from '../support/child-login.js';
import { addChild, newAccount } from '../support/children.js';
import { createFamily, signInParent } from '../support/families.js';

/** What the child's own settings see and change: personal data, each value its own. */
const PERSONAL = {
  nickname: '米粒self',
  changed: '米米self',
  refused: '米'.repeat(11),
  familyName: '林悦的家logs',
  account: newAccount(),
};

/**
 * Lets a child read its settings on the running api, change the nickname
 * and be refused twice, then stops the api and answers everything it wrote.
 */
async function logsOfTheSettings(started: BuiltAppWithServices): Promise<string> {
  const { api } = started;
  const parent = await signInParent(api);
  const family = await createFamily(api, parent, {
    name: PERSONAL.familyName,
    timezone: 'Asia/Shanghai',
  });
  const child = await addChild(api, parent, family.id, {
    nickname: PERSONAL.nickname,
    account: PERSONAL.account,
  });
  const { browser } = await signInWithNewPassword(api, parent, family.id, child.id);
  const statuses = [
    (await browser.me()).status,
    (await browser.rename({ nickname: PERSONAL.changed })).status,
    (await browser.rename({ nickname: PERSONAL.refused })).status,
    (await browser.rename({ nickname: PERSONAL.changed, account: PERSONAL.account })).status,
  ];
  expect(statuses).toEqual([200, 200, 400, 400]);
  return started.stopApp();
}

// A child's nickname and account and the family's name are personal data,
// so the child's own settings write none of them to the logs: not when
// they are read, not when the nickname is changed, and not when a change
// is refused. The built api runs as a separate process and everything it
// writes is read, as the platform's log collector would.
describe("Logs of the child's own settings", () => {
  let started: BuiltAppWithServices | undefined;

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('hold the requests and none of the nicknames, the account or the family name', async () => {
    if (started === undefined) {
      throw new Error('The api did not start');
    }

    const written = await logsOfTheSettings(started);

    expect(written).toContain('/api/child/me');
    for (const value of Object.values(PERSONAL)) {
      expect(written).not.toContain(value);
    }
  });
});
