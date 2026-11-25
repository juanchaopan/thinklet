import type { FamilyDetail } from '@thinklet/contracts';
import { startAppWithServices, type AppWithServices } from '../support/app.js';
import {
  ChildBrowser,
  addChildWithPassword,
  linkPath,
  newLoginLink,
  type ChildWithPassword,
} from '../support/child-login.js';
import { childPath, childrenPath } from '../support/children.js';
import { as, createFamily, outcomesOf, signInParent, type Parent } from '../support/families.js';

// Acceptance criterion 24 with Redis down: the login links live in Redis
// only, so while it cannot be reached a parent cannot make a QR code and a
// child cannot open or use one, each answered 500 internal (the pages show
// their own error); the family code login, the parents' pages and the
// deletion of a child go on.
describe('login links while Redis cannot be reached', () => {
  let started: AppWithServices;
  let parent: Parent;
  let family: FamilyDetail;
  let child: ChildWithPassword;
  let token: string;
  let linkId: string;

  const server = () => started.app.getHttpServer();

  beforeAll(async () => {
    started = await startAppWithServices();
    parent = await signInParent(server(), { name: '林悦' });
    family = await createFamily(server(), parent);
    child = await addChildWithPassword(server(), parent, family.id, { nickname: '小米' });
    ({ token, id: linkId } = await newLoginLink(server(), parent, family.id, child.id));
    await started.services.redis.container.stop();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('answers making a link and reading its state with 500 internal', async () => {
    const links = `${childPath(family.id, child.id)}/login-links`;

    const responses = [
      await as(server(), parent).post(links),
      await as(server(), parent).get(`${links}/${linkId}`),
    ];

    expect(outcomesOf(responses)).toEqual([
      [500, 'internal'],
      [500, 'internal'],
    ]);
  });

  it('answers opening and using a link with 500 internal, signing nobody in', async () => {
    const kid = new ChildBrowser(server());

    const responses = [
      await kid.get(linkPath(token)),
      await kid.post(`${linkPath(token)}/login`, { password: child.password, remember: false }),
      await kid.post(`${linkPath(token)}/password`, { password: 'my secret', remember: false }),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [500, 'internal']));
    expect((await kid.me()).status).toBe(401);
  });

  it('logs the child in with the family code, the account and the password', async () => {
    const kid = new ChildBrowser(server());

    const response = await kid.login({
      code: family.code,
      account: child.account,
      password: child.password,
      remember: true,
    });

    expect(response.status).toBe(200);
    expect((await kid.me()).status).toBe(200);
  });

  it("lists the family's children and deletes one", async () => {
    const listed = await as(server(), parent).get(childrenPath(family.id));
    const deleted = await as(server(), parent).delete(childPath(family.id, child.id));

    expect(listed.status).toBe(200);
    expect(deleted.status).toBe(204);
  });
});
