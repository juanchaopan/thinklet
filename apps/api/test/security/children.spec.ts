import { childLoginLinkSchema, type Child, type FamilyDetail } from '@thinklet/contracts';
import request from 'supertest';
import {
  addChild,
  childPath,
  childRow,
  childrenPath,
  deviceRows,
  insertDevice,
  loginLinkRows,
} from '../support/children.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import {
  addMember,
  as,
  createFamily,
  outcomesOf,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { cookieHeader, testSessionTokens } from '../support/login.js';

/** A family with its admin, one member, and a child with a login link and a remembered device. */
interface Household {
  family: FamilyDetail;
  admin: Parent;
  member: Parent;
  child: Child;
  linkId: string;
  deviceId: string;
}

/** One of the children routes: its method, its path and the body it is sent with. */
interface Route {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  body?: object;
}

/** The ids a children route can name. */
interface Ids {
  familyId: string;
  childId: string;
  linkId: string;
  deviceId: string;
}

const NEW_CHILD = { nickname: '小米', account: 'xiaomi', consent: true };

/** The routes of one child, naming the given ids. */
function childRoutes({ familyId, childId, linkId, deviceId }: Ids): Route[] {
  const child = childPath(familyId, childId);
  return [
    { method: 'patch', path: child, body: { nickname: '被改掉了', account: 'changed' } },
    { method: 'post', path: `${child}/password-reset` },
    { method: 'post', path: `${child}/login-links` },
    { method: 'get', path: `${child}/login-links/${linkId}` },
    { method: 'get', path: `${child}/devices` },
    { method: 'delete', path: `${child}/devices/${deviceId}` },
    { method: 'delete', path: `${child}/devices` },
    { method: 'delete', path: child },
  ];
}

/** Every children route, naming the given ids. */
function everyRoute(ids: Ids): Route[] {
  const children = childrenPath(ids.familyId);
  return [
    { method: 'get', path: children },
    { method: 'post', path: children, body: NEW_CHILD },
    ...childRoutes(ids),
  ];
}

/** The routes that change data: every route but the reads. */
const writes = (routes: Route[]) => routes.filter(({ method }) => method !== 'get');

/** The same answer for every response. */
const each = (responses: request.Response[], outcome: [number, string]) =>
  responses.map(() => outcome);

// Security test cases of .docs/architecture.md ("指标和要求", 安全) for the
// children routes: a parent cannot see or change the children of a family
// they are not in, whether by the family id in the address or by another
// family's child, link or device id under their own family (IDOR); the
// routes need a parent's login, so a child's login opens none of them; the
// writes need this site's Origin; a body cannot set what the api sets
// itself; what a parent types is stored and answered as data, never run.
describe('children security', () => {
  const running = useAppWithServices();
  let ours: Household;
  let theirs: Household;

  /** Sends each route, with the request prepared as the case needs. */
  async function send(
    routes: Route[],
    prepare: (call: request.Test) => request.Test,
  ): Promise<request.Response[]> {
    const responses: request.Response[] = [];
    for (const { method, path, body } of routes) {
      responses.push(await prepare(request(running.server)[method](path)).send(body));
    }
    return responses;
  }

  /** Sends each route as the parent, with this site's Origin. */
  const sendAs = (parent: Parent, routes: Route[]) =>
    send(routes, (call) =>
      call.set('Origin', TEST_APP_ORIGIN).set('Cookie', cookieHeader(parent.cookies)),
    );

  async function household(name: string): Promise<Household> {
    const admin = await signInParent(running.server, { name: `${name}管理员` });
    const member = await signInParent(running.server, { name: `${name}家长` });
    const family = await createFamily(running.server, admin, { name, timezone: 'Asia/Shanghai' });
    await addMember(running.databaseUrl, family.id, member.id);
    const child = await addChild(running.server, admin, family.id);
    const link = await as(running.server, admin).post(
      `${childPath(family.id, child.id)}/login-links`,
    );
    const deviceId = await insertDevice(running.databaseUrl, child.id, {
      name: 'iPad · Safari',
      rememberedAt: new Date(),
      lastUsedAt: new Date(),
    });
    const linkId = childLoginLinkSchema.parse(link.body).id;
    return { family, admin, member, child, linkId, deviceId };
  }

  /** Everything the database holds about the household's child. */
  async function stateOf({ child }: Household) {
    return {
      child: await childRow(running.databaseUrl, child.id),
      links: await loginLinkRows(running.databaseUrl, child.id),
      devices: await deviceRows(running.databaseUrl, child.id),
    };
  }

  const idsOf = ({ family, child, linkId, deviceId }: Household): Ids => ({
    familyId: family.id,
    childId: child.id,
    linkId,
    deviceId,
  });

  beforeAll(async () => {
    ours = await household('我们家');
    theirs = await household('他们家');
  });

  it.each(['admin', 'member'] as const)(
    "answers the %s of another family with 404 family_not_found on every route of that family's children",
    async (role) => {
      const before = await stateOf(theirs);

      const responses = await sendAs(ours[role], everyRoute(idsOf(theirs)));

      expect(outcomesOf(responses)).toEqual(each(responses, [404, 'family_not_found']));
      expect(responses.map(({ body }) => Object.keys(body as object))).toEqual(
        responses.map(() => ['error']),
      );
      expect(await stateOf(theirs)).toEqual(before);
    },
  );

  it("answers another family's child under the parent's own family with 404 child_not_found", async () => {
    const before = await stateOf(theirs);

    const responses = await sendAs(
      ours.member,
      childRoutes({ ...idsOf(theirs), familyId: ours.family.id }),
    );

    expect(outcomesOf(responses)).toEqual(each(responses, [404, 'child_not_found']));
    expect(await stateOf(theirs)).toEqual(before);
  });

  it("does not reach another family's login link or device through the parent's own child", async () => {
    const before = await stateOf(theirs);
    const client = as(running.server, ours.admin);
    const child = childPath(ours.family.id, ours.child.id);

    const status = await client.get(`${child}/login-links/${theirs.linkId}`);
    const revoke = await client.delete(`${child}/devices/${theirs.deviceId}`);

    expect(outcomesOf([status])).toEqual([[404, 'not_found']]);
    expect(revoke.status).toBe(204);
    expect(await stateOf(theirs)).toEqual(before);
  });

  it('needs a login on every children route', async () => {
    const responses = await send(everyRoute(idsOf(ours)), (call) =>
      call.set('Origin', TEST_APP_ORIGIN),
    );

    expect(outcomesOf(responses)).toEqual(each(responses, [401, 'unauthenticated']));
  });

  it.each(['thinklet_child_session', 'thinklet_session'])(
    "does not open any children route with a child's login in the cookie %s",
    async (cookie) => {
      const before = await stateOf(ours);
      const login = await testSessionTokens().issueSession('child', ours.child.id);

      const responses = await send(everyRoute(idsOf(ours)), (call) =>
        call.set('Origin', TEST_APP_ORIGIN).set('Cookie', cookieHeader({ [cookie]: login })),
      );

      expect(outcomesOf(responses)).toEqual(each(responses, [401, 'unauthenticated']));
      expect(await stateOf(ours)).toEqual(before);
    },
  );

  it.each<[string, (call: request.Test) => request.Test]>([
    ['without an Origin', (call) => call],
    ['from another site', (call) => call.set('Origin', 'https://evil.example')],
  ])("refuses every change %s even with a parent's login", async (_case, withOrigin) => {
    const before = await stateOf(ours);

    const responses = await send(writes(everyRoute(idsOf(ours))), (call) =>
      withOrigin(call.set('Cookie', cookieHeader(ours.admin.cookies))),
    );

    expect(outcomesOf(responses)).toEqual(each(responses, [403, 'bad_origin']));
    expect(await stateOf(ours)).toEqual(before);
  });

  it('refuses fields that would set the family, the consent or the password', async () => {
    const before = await stateOf(ours);
    const children = childrenPath(ours.family.id);
    const child = childPath(ours.family.id, ours.child.id);

    const responses = await sendAs(ours.admin, [
      { method: 'post', path: children, body: { ...NEW_CHILD, familyId: theirs.family.id } },
      { method: 'post', path: children, body: { ...NEW_CHILD, consentParentId: theirs.admin.id } },
      { method: 'post', path: children, body: { ...NEW_CHILD, passwordHash: 'x' } },
      { method: 'patch', path: child, body: { familyId: theirs.family.id } },
      { method: 'patch', path: child, body: { password: 'secret1' } },
    ]);

    expect(outcomesOf(responses)).toEqual(each(responses, [400, 'invalid_request']));
    expect(await stateOf(ours)).toEqual(before);
  });

  it.each(['<i>米</i>', "';drop--"])(
    'stores the nickname %j as data and answers it as JSON',
    async (nickname) => {
      const child = await addChild(running.server, ours.admin, ours.family.id, { nickname });

      const response = await as(running.server, ours.member).get(childrenPath(ours.family.id));

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toContainEqual(child);
      expect(child.nickname).toBe(nickname);
    },
  );
});
