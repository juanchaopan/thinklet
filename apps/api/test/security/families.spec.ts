import type { NestExpressApplication } from '@nestjs/platform-express';
import { familyDetailSchema, type FamilyDetail } from '@thinklet/contracts';
import request from 'supertest';
import { startAppWithServices, type AppWithServices } from '../support/app.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { query } from '../support/database.js';
import {
  addMember,
  addPendingRequest,
  as,
  createFamily,
  familyRow,
  memberRows,
  outcomesOf,
  signInParent,
  type Parent,
} from '../support/families.js';
import { FOREIGN_ORIGINS, sendRoutes } from '../support/routes.js';

/** A family with its admin and one member. */
interface Household {
  family: FamilyDetail;
  admin: Parent;
  member: Parent;
}

// Security test cases of .docs/architecture.md ("指标和要求", 安全): a parent
// who is not a member of a family cannot see, change or delete any of it by
// changing the ids in the address or the body (IDOR), not even the admin of
// another family; the routes need a login and this site's Origin; what a
// parent types is stored and answered as data, never run.
describe('family security', () => {
  let started: AppWithServices;
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  let ours: Household;
  let theirs: Household;

  async function household(name: string): Promise<Household> {
    const admin = await signInParent(server, { name: `${name}管理员`, email: 'admin@example.com' });
    const member = await signInParent(server, { name: `${name}家长` });
    const family = await createFamily(server, admin, { name, timezone: 'Asia/Shanghai' });
    await addMember(started.databaseUrl, family.id, member.id);
    return { family, admin, member };
  }

  /** Everything the database holds about the family: its row, its members and its requests. */
  async function stateOf(familyId: string) {
    return {
      family: await familyRow(started.databaseUrl, familyId),
      members: await memberRows(started.databaseUrl, familyId),
      requests: await query(
        started.databaseUrl,
        'select id, status, closed_at from join_requests where family_id = $1 order by id',
        [familyId],
      ),
    };
  }

  beforeAll(async () => {
    started = await startAppWithServices();
    ({ app } = started);
    server = app.getHttpServer();
    ours = await household('我们家');
    theirs = await household('他们家');
    const applicant = await signInParent(server);
    await addPendingRequest(started.databaseUrl, theirs.family, applicant.id);
  });

  afterAll(async () => {
    await started?.stop();
  });

  /** Every route of the target's family, sent by the parent, deleting the family last. */
  async function everyRoute(by: Parent, target: Household): Promise<request.Response[]> {
    const client = as(server, by);
    const path = `/api/families/${target.family.id}`;
    return [
      await client.get(path),
      await client.patch(path, { name: '被改掉了', timezone: 'UTC' }),
      await client.post(`${path}/code`),
      await client.put(`${path}/admin`, { parentId: by.id }),
      await client.put(`${path}/admin`, { parentId: target.member.id }),
      await client.delete(`${path}/members/${target.member.id}`),
      await client.delete(`${path}/members/${target.admin.id}`),
      await client.delete(`${path}/members/${by.id}`),
      await client.delete(path),
    ];
  }

  it.each([
    ['the admin', 'admin'],
    ['a member', 'member'],
  ] as const)(
    'answers %s of another family with 404 on every route of it, revealing, changing and deleting nothing',
    async (_who, role) => {
      const before = await stateOf(theirs.family.id);

      const responses = await everyRoute(ours[role], theirs);

      expect(responses.map((response): unknown[] => [response.status, response.body])).toEqual(
        responses.map(({ headers }) => [
          404,
          { error: { code: 'family_not_found', requestId: headers['x-request-id'] } },
        ]),
      );
      expect(await stateOf(theirs.family.id)).toEqual(before);
    },
  );

  it('answers a family that does not exist the same as one the parent is not in', async () => {
    const client = as(server, ours.admin);

    const responses = [
      await client.get(`/api/families/${crypto.randomUUID()}`),
      await client.get(`/api/families/${theirs.family.id}`),
      await client.delete(`/api/families/${crypto.randomUUID()}`),
      await client.delete(`/api/families/${theirs.family.id}`),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'family_not_found']));
  });

  it.each([
    "' or '1'='1",
    '00000000-0000-0000-0000-000000000000',
    'null',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ])('answers the family id %j with 404 family_not_found', async (familyId) => {
    const response = await as(server, ours.admin).get(
      `/api/families/${encodeURIComponent(familyId)}`,
    );

    expect(outcomesOf([response])).toEqual([[404, 'family_not_found']]);
  });

  it('does not open or delete another family by its id in capitals', async () => {
    const before = await stateOf(theirs.family.id);
    const client = as(server, ours.admin);
    const path = `/api/families/${theirs.family.id.toUpperCase()}`;

    const responses = [await client.get(path), await client.delete(path)];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'family_not_found']));
    expect(await stateOf(theirs.family.id)).toEqual(before);
  });

  it("cannot reach another family's parents through its own family", async () => {
    const before = await stateOf(theirs.family.id);
    const client = as(server, ours.admin);
    const path = `/api/families/${ours.family.id}`;

    const responses = [
      await client.put(`${path}/admin`, { parentId: theirs.member.id }),
      await client.delete(`${path}/members/${theirs.member.id}`),
      await client.delete(`${path}/members/${theirs.admin.id}`),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [409, 'not_a_member']));
    expect(await stateOf(theirs.family.id)).toEqual(before);
    expect((await memberRows(started.databaseUrl, ours.family.id)).map(({ role }) => role)).toEqual(
      ['admin', 'member'],
    );
  });

  it('shows a member only the members of their own family', async () => {
    const response = await as(server, ours.member).get(`/api/families/${ours.family.id}`);

    const detail = familyDetailSchema.parse(response.body);
    expect(detail.members.map(({ parentId }) => parentId)).toEqual([ours.admin.id, ours.member.id]);
  });

  it('refuses fields that would set the code, a role or another id', async () => {
    const client = as(server, ours.admin);
    const before = await stateOf(ours.family.id);

    const responses = [
      await client.post('/api/families', { name: '新家', timezone: 'UTC', code: '222222' }),
      await client.post('/api/families', { name: '新家', timezone: 'UTC', role: 'member' }),
      await client.patch(`/api/families/${ours.family.id}`, { code: '222222' }),
      await client.patch(`/api/families/${ours.family.id}`, { role: 'member' }),
      await client.patch(`/api/families/${ours.family.id}`, { id: theirs.family.id }),
      await client.put(`/api/families/${ours.family.id}/admin`, {
        parentId: ours.member.id,
        familyId: theirs.family.id,
      }),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [400, 'invalid_request']));
    expect(await stateOf(ours.family.id)).toEqual(before);
  });

  it.each(['<b onclick=x>hi</b>', "';drop table x;--"])(
    'stores the name %j as text and answers it as JSON',
    async (name) => {
      const family = await createFamily(server, ours.admin, { name, timezone: 'UTC' });

      const response = await as(server, ours.admin).get(`/api/families/${family.id}`);

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toMatchObject({ name });
      expect(await familyRow(started.databaseUrl, family.id)).toMatchObject({ name });
    },
  );

  it('needs a login on every family route', async () => {
    const path = `/api/families/${ours.family.id}`;
    const anonymous = (call: request.Test) => call.set('Origin', TEST_APP_ORIGIN);

    const responses = [
      await anonymous(request(server).post('/api/families')).send({ name: '家', timezone: 'UTC' }),
      await anonymous(request(server).get(path)),
      await anonymous(request(server).patch(path)).send({ name: '家' }),
      await anonymous(request(server).post(`${path}/code`)),
      await anonymous(request(server).put(`${path}/admin`)).send({ parentId: ours.member.id }),
      await anonymous(request(server).delete(`${path}/members/${ours.member.id}`)),
      await anonymous(request(server).delete(path)),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [401, 'unauthenticated']));
  });

  it.each(FOREIGN_ORIGINS)(
    "refuses a change and the deletion %s even with the admin's login",
    async (_case, foreign) => {
      const before = await stateOf(ours.family.id);
      const path = `/api/families/${ours.family.id}`;

      const responses = await sendRoutes(
        server,
        [
          { method: 'patch', path, body: { name: '被改掉了' } },
          { method: 'delete', path },
        ],
        foreign(ours.admin),
      );

      expect(outcomesOf(responses)).toEqual(responses.map(() => [403, 'bad_origin']));
      expect(await stateOf(ours.family.id)).toEqual(before);
    },
  );
});
