import { childLoginLinkSchema } from '@thinklet/contracts';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { addChild, childPath, childrenPath, newAccount } from '../support/children.js';
import { as, createFamily, signInParent } from '../support/families.js';

// A child's nickname and account are personal data, and the token of a
// login link logs the child in, so none of them may reach the logs: not on
// the routes that take them, nor on those that answer with them, nor when a
// request is refused. The built api runs as a separate process and
// everything it writes is read, as the platform's log collector would.
describe('Logs of the children routes', () => {
  const nickname = '米粒logs';
  const account = newAccount();
  const changedAccount = newAccount();
  let token: string;
  let started: BuiltAppWithServices;
  let output: string;

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    const { api } = started;
    const parent = await signInParent(api);
    const { id: familyId } = await createFamily(api, parent);
    const client = as(api, parent);
    const refusedAdd = { nickname, account: account.toUpperCase(), consent: false };

    const child = await addChild(api, parent, familyId, { nickname, account });
    const path = childPath(familyId, child.id);
    await client.get(childrenPath(familyId)).expect(200);
    await client.post(childrenPath(familyId), { nickname, account, consent: true }).expect(409);
    await client.post(childrenPath(familyId), refusedAdd).expect(400);
    await client.patch(path, { nickname, account: changedAccount }).expect(200);
    const link = await client.post(`${path}/login-links`).expect(201);
    const { id: linkId, url } = childLoginLinkSchema.parse(link.body);
    token = url.slice(url.lastIndexOf('/') + 1);
    await client.get(`${path}/login-links/${linkId}`).expect(200);
    await client.get(`${path}/devices`).expect(200);

    output = await started.stopApp();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('logged the requests', () => {
    expect(output).toContain('/children');
  });

  it('contains neither the nickname, the accounts nor the token of the login link', () => {
    for (const value of [nickname, account, account.toUpperCase(), changedAccount, token]) {
      expect(output).not.toContain(value);
    }
  });
});
