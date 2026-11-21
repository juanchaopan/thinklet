import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  errorResponseSchema,
  familyDetailSchema,
  meResponseSchema,
  type FamilyDetail,
} from '@thinklet/contracts';
import { startAppWithServices, type AppWithServices } from '../support/app.js';
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

const FAMILY_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

// Acceptance criteria covered: creating a family makes the parent its admin
// with a six-character code of the allowed characters and the chosen time
// zone; a parent of two families has both; the admin's new name and time
// zone stay after a reload; a new code replaces the old one and expires the
// pending requests made with it; a parent who is not the admin cannot change
// the family or take anyone out; a removed or departed parent can no longer
// open the family; the admin cannot leave before handing over the admin
// role, after which the new admin can change the settings and the old one
// cannot, but can leave; a parent who is not a member cannot read or change
// the family by changing the id in the address.
describe('families', () => {
  let started: AppWithServices;
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;

  const parent = (claims?: Record<string, unknown>) => signInParent(server, claims);
  const asParent = (someone: Parent) => as(server, someone);
  const members = (familyId: string) => memberRows(started.databaseUrl, familyId);
  const familyOf = (familyId: string) => familyRow(started.databaseUrl, familyId);
  const stateOf = async (familyId: string) => ({
    family: await familyOf(familyId),
    members: await members(familyId),
  });

  /** A family with its admin and one member. */
  async function familyWithMember(): Promise<{
    family: FamilyDetail;
    admin: Parent;
    member: Parent;
  }> {
    const admin = await parent({ name: '林悦', email: 'linyue@example.com' });
    const member = await parent({ name: '周子航' });
    const family = await createFamily(server, admin);
    await addMember(started.databaseUrl, family.id, member.id);
    return { family, admin, member };
  }

  beforeAll(async () => {
    started = await startAppWithServices();
    ({ app } = started);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await started?.stop();
  });

  describe('POST /api/families', () => {
    it('creates the family with its creator as the admin', async () => {
      const creator = await parent({ name: '林悦', email: 'linyue@example.com' });

      const response = await asParent(creator).post('/api/families', {
        name: '  林悦的家 ',
        timezone: 'America/Toronto',
      });

      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      const family = familyDetailSchema.parse(response.body);
      expect(family).toMatchObject({
        name: '林悦的家',
        timezone: 'America/Toronto',
        role: 'admin',
        members: [
          {
            parentId: creator.id,
            name: '林悦',
            email: 'linyue@example.com',
            role: 'admin',
            you: true,
          },
        ],
      });
      expect(family.code).toMatch(FAMILY_CODE);
      expect(await familyOf(family.id)).toMatchObject({
        name: '林悦的家',
        timezone: 'America/Toronto',
        code: family.code,
      });
      expect(await members(family.id)).toEqual([{ parent_id: creator.id, role: 'admin' }]);
    });

    it('gives every family its own code', async () => {
      const creator = await parent();

      const families = await Promise.all(
        Array.from({ length: 10 }, () => createFamily(server, creator)),
      );

      expect(new Set(families.map(({ code }) => code)).size).toBe(10);
      for (const { code } of families) {
        expect(code).toMatch(FAMILY_CODE);
      }
    });

    it('lists the new family in GET /api/me', async () => {
      const creator = await parent();

      const family = await createFamily(server, creator, { name: '外婆家', timezone: 'UTC' });

      const me = meResponseSchema.parse((await asParent(creator).get('/api/me')).body);
      expect(me.families).toEqual([
        { id: family.id, name: '外婆家', role: 'admin', pendingRequests: 0 },
      ]);
    });

    it.each([
      [{ name: '', timezone: 'Asia/Shanghai' }, [{ path: 'name', code: 'required' }]],
      [
        { name: '一二三四五六七八九十一二三四五六七八九十多', timezone: 'Asia/Shanghai' },
        [{ path: 'name', code: 'too_long' }],
      ],
      [{ name: '林悦的家', timezone: 'Mars/Phobos' }, [{ path: 'timezone', code: 'invalid' }]],
      [{ name: '林悦的家' }, [{ path: 'timezone', code: 'required' }]],
    ])('refuses %j with 400 and the fields', async (body, fields) => {
      const response = await asParent(await parent()).post('/api/families', body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'invalid_request', fields } });
    });
  });

  describe('GET /api/families/{familyId}', () => {
    it('shows every member in joining order with their email and which one is you', async () => {
      const { family, admin, member } = await familyWithMember();

      const response = await asParent(member).get(`/api/families/${family.id}`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(familyDetailSchema.parse(response.body)).toEqual({
        id: family.id,
        name: '林悦的家',
        timezone: 'Asia/Shanghai',
        code: family.code,
        role: 'member',
        members: [
          {
            parentId: admin.id,
            name: '林悦',
            email: 'linyue@example.com',
            role: 'admin',
            you: false,
          },
          { parentId: member.id, name: '周子航', email: null, role: 'member', you: true },
        ],
      });
    });
  });

  describe('a parent who is not a member', () => {
    it('gets 404 family_not_found from every route of the family and changes nothing', async () => {
      const { family, admin, member } = await familyWithMember();
      const stranger = asParent(await parent());
      const before = await stateOf(family.id);

      const responses = [
        await stranger.get(`/api/families/${family.id}`),
        await stranger.patch(`/api/families/${family.id}`, { name: '别人的家' }),
        await stranger.post(`/api/families/${family.id}/code`),
        await stranger.put(`/api/families/${family.id}/admin`, { parentId: member.id }),
        await stranger.delete(`/api/families/${family.id}/members/${member.id}`),
        await stranger.delete(`/api/families/${family.id}/members/${admin.id}`),
      ];

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'family_not_found']));
      expect(await stateOf(family.id)).toEqual(before);
    });

    it('gets the same 404 for a family that does not exist and for an id that is not one', async () => {
      const stranger = asParent(await parent());
      const familyIds = [crypto.randomUUID(), 'not-an-id', '1'];

      const responses = await Promise.all(
        familyIds.map((familyId) => stranger.get(`/api/families/${familyId}`)),
      );

      expect(outcomesOf(responses)).toEqual(familyIds.map(() => [404, 'family_not_found']));
    });
  });

  describe('a member who is not the admin', () => {
    it('gets 403 not_admin for every change of the admin and changes nothing', async () => {
      const { family, admin, member } = await familyWithMember();
      const third = await parent();
      await addMember(started.databaseUrl, family.id, third.id);
      const before = await stateOf(family.id);
      const asMember = asParent(member);

      const responses = [
        await asMember.patch(`/api/families/${family.id}`, { name: '周家', timezone: 'UTC' }),
        await asMember.post(`/api/families/${family.id}/code`),
        await asMember.put(`/api/families/${family.id}/admin`, { parentId: member.id }),
        await asMember.delete(`/api/families/${family.id}/members/${third.id}`),
        await asMember.delete(`/api/families/${family.id}/members/${admin.id}`),
      ];

      expect(outcomesOf(responses)).toEqual(responses.map(() => [403, 'not_admin']));
      expect(await stateOf(family.id)).toEqual(before);
    });
  });

  describe('PATCH /api/families/{familyId}', () => {
    it('changes the name and the time zone, which stay after a reload', async () => {
      const { family, admin, member } = await familyWithMember();

      const response = await asParent(admin).patch(`/api/families/${family.id}`, {
        name: ' 外婆家 ',
        timezone: 'Europe/London',
      });

      expect(response.status).toBe(200);
      expect(familyDetailSchema.parse(response.body)).toMatchObject({
        name: '外婆家',
        timezone: 'Europe/London',
        code: family.code,
        role: 'admin',
      });
      const reloaded = await asParent(member).get(`/api/families/${family.id}`);
      expect(reloaded.body).toMatchObject({ name: '外婆家', timezone: 'Europe/London' });
    });

    it('changes only the field it is given and records when', async () => {
      const { family, admin } = await familyWithMember();
      const before = await familyOf(family.id);

      await asParent(admin).patch(`/api/families/${family.id}`, { timezone: 'Asia/Tokyo' });

      const after = await familyOf(family.id);
      expect(after).toMatchObject({ name: '林悦的家', timezone: 'Asia/Tokyo', code: family.code });
      expect(after.updated_at).not.toEqual(before.updated_at);
    });

    it('keeps the last of two changes', async () => {
      const { family, admin } = await familyWithMember();

      await asParent(admin).patch(`/api/families/${family.id}`, { name: '第一个名字' });
      await asParent(admin).patch(`/api/families/${family.id}`, { name: '第二个名字' });

      expect(await familyOf(family.id)).toMatchObject({ name: '第二个名字' });
    });

    it('refuses a name that is too long and a time zone that is not one', async () => {
      const { family, admin } = await familyWithMember();

      const response = await asParent(admin).patch(`/api/families/${family.id}`, {
        name: '家'.repeat(21),
        timezone: '+08:00',
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'invalid_request',
          fields: [
            { path: 'name', code: 'too_long' },
            { path: 'timezone', code: 'invalid' },
          ],
        },
      });
      expect(await familyOf(family.id)).toMatchObject({ name: '林悦的家' });
    });
  });

  describe('POST /api/families/{familyId}/code', () => {
    it('gives a new code and expires the pending requests made with the old one', async () => {
      const { family, admin } = await familyWithMember();
      const pending = await addPendingRequest(started.databaseUrl, family, (await parent()).id);
      const closedAt = new Date('2026-11-01T08:00:00Z');
      const [rejected] = await query<{ id: string }>(
        started.databaseUrl,
        `insert into join_requests (family_id, parent_id, code, status, closed_at, closed_by)
         values ($1, $2, $3, 'rejected', $4, $5) returning id`,
        [family.id, (await parent()).id, family.code, closedAt, admin.id],
      );
      const [clock] = await query<{ now: Date }>(started.databaseUrl, 'select now() as now');

      const response = await asParent(admin).post(`/api/families/${family.id}/code`);

      expect(response.status).toBe(200);
      const changed = familyDetailSchema.parse(response.body);
      expect(changed.code).not.toBe(family.code);
      expect(changed.code).toMatch(FAMILY_CODE);
      expect(await familyOf(family.id)).toMatchObject({ code: changed.code });
      const requests = await query<{
        id: string;
        status: string;
        closed_at: Date | null;
        closed_by: string | null;
      }>(
        started.databaseUrl,
        'select id, status, closed_at, closed_by from join_requests where family_id = $1',
        [family.id],
      );
      const expired = requests.find(({ id }) => id === pending);
      expect(expired).toMatchObject({ status: 'expired', closed_by: null });
      expect(expired?.closed_at?.getTime()).toBeGreaterThan((clock?.now.getTime() ?? 0) - 60_000);
      expect(requests.find(({ id }) => id === rejected?.id)).toMatchObject({
        status: 'rejected',
        closed_at: closedAt,
        closed_by: admin.id,
      });
    });

    it('leaves the pending requests to other families alone', async () => {
      const { family, admin } = await familyWithMember();
      const other = await createFamily(server, await parent());
      await addPendingRequest(started.databaseUrl, other, (await parent()).id);

      await asParent(admin).post(`/api/families/${family.id}/code`);

      const rows = await query<{ status: string }>(
        started.databaseUrl,
        'select status from join_requests where family_id = $1',
        [other.id],
      );
      expect(rows).toEqual([{ status: 'pending' }]);
    });
  });

  describe('PUT /api/families/{familyId}/admin', () => {
    it('hands the admin role over: the new admin can change the settings, the old one cannot but can leave', async () => {
      const { family, admin, member } = await familyWithMember();

      const response = await asParent(admin).put(`/api/families/${family.id}/admin`, {
        parentId: member.id,
      });

      expect(response.status).toBe(200);
      expect(familyDetailSchema.parse(response.body)).toMatchObject({
        role: 'member',
        members: [
          { parentId: admin.id, role: 'member', you: true },
          { parentId: member.id, role: 'admin', you: false },
        ],
      });
      expect(await members(family.id)).toEqual([
        { parent_id: admin.id, role: 'member' },
        { parent_id: member.id, role: 'admin' },
      ]);

      const byNewAdmin = await asParent(member).patch(`/api/families/${family.id}`, {
        name: '周家',
      });
      expect(byNewAdmin.status).toBe(200);

      const byOldAdmin = await asParent(admin).patch(`/api/families/${family.id}`, {
        name: '林家',
      });
      expect(outcomesOf([byOldAdmin])).toEqual([[403, 'not_admin']]);
      expect(await familyOf(family.id)).toMatchObject({ name: '周家' });

      const leaving = await asParent(admin).delete(
        `/api/families/${family.id}/members/${admin.id}`,
      );
      expect(leaving.status).toBe(204);
      expect(await members(family.id)).toEqual([{ parent_id: member.id, role: 'admin' }]);
    });

    it('refuses a new admin who is not a member with 409 not_a_member', async () => {
      const { family, admin } = await familyWithMember();
      const outsider = await parent();
      const before = await stateOf(family.id);

      const responses = [
        await asParent(admin).put(`/api/families/${family.id}/admin`, { parentId: outsider.id }),
        await asParent(admin).put(`/api/families/${family.id}/admin`, {
          parentId: crypto.randomUUID(),
        }),
      ];

      expect(outcomesOf(responses)).toEqual([
        [409, 'not_a_member'],
        [409, 'not_a_member'],
      ]);
      expect(await stateOf(family.id)).toEqual(before);
    });
  });

  describe('DELETE /api/families/{familyId}/members/{parentId}', () => {
    it('lets the admin take out a member, who can no longer open the family', async () => {
      const { family, admin, member } = await familyWithMember();

      const response = await asParent(admin).delete(
        `/api/families/${family.id}/members/${member.id}`,
      );

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      const opened = await asParent(member).get(`/api/families/${family.id}`);
      expect(outcomesOf([opened])).toEqual([[404, 'family_not_found']]);
      const me = meResponseSchema.parse((await asParent(member).get('/api/me')).body);
      expect(me.families).toEqual([]);
    });

    it('lets a member leave, after which they can no longer open the family', async () => {
      const { family, admin, member } = await familyWithMember();

      const response = await asParent(member).delete(
        `/api/families/${family.id}/members/${member.id}`,
      );

      expect(response.status).toBe(204);
      const opened = await asParent(member).get(`/api/families/${family.id}`);
      expect(outcomesOf([opened])).toEqual([[404, 'family_not_found']]);
      const detail = familyDetailSchema.parse(
        (await asParent(admin).get(`/api/families/${family.id}`)).body,
      );
      expect(detail.members.map(({ parentId }) => parentId)).toEqual([admin.id]);
    });

    it('does not let the admin leave before handing over the admin role', async () => {
      const { family, admin } = await familyWithMember();
      const before = await stateOf(family.id);

      const response = await asParent(admin).delete(
        `/api/families/${family.id}/members/${admin.id}`,
      );

      expect(outcomesOf([response])).toEqual([[409, 'admin_cannot_leave']]);
      expect(await stateOf(family.id)).toEqual(before);
    });

    it('refuses taking out a parent who is no longer in the family with 409 not_a_member', async () => {
      const { family, admin, member } = await familyWithMember();
      await asParent(admin).delete(`/api/families/${family.id}/members/${member.id}`);

      const responses = [
        await asParent(admin).delete(`/api/families/${family.id}/members/${member.id}`),
        await asParent(admin).delete(`/api/families/${family.id}/members/${crypto.randomUUID()}`),
      ];

      expect(outcomesOf(responses)).toEqual([
        [409, 'not_a_member'],
        [409, 'not_a_member'],
      ]);
    });
  });

  describe('a parent id that is not an id', () => {
    it('is refused with 400 and the parentId field, in the body and in the path', async () => {
      const { family, admin } = await familyWithMember();
      const before = await stateOf(family.id);

      const responses = [
        await asParent(admin).put(`/api/families/${family.id}/admin`, { parentId: 'someone' }),
        await asParent(admin).delete(`/api/families/${family.id}/members/someone`),
      ];

      expect(
        responses.map(({ status, body }) => [status, errorResponseSchema.parse(body).error]),
      ).toEqual(
        responses.map(({ headers }) => [
          400,
          {
            code: 'invalid_request',
            requestId: headers['x-request-id'],
            fields: [{ path: 'parentId', code: 'invalid' }],
          },
        ]),
      );
      expect(await stateOf(family.id)).toEqual(before);
    });
  });

  describe('a parent of two families', () => {
    it('sees both in GET /api/me in joining order, each with its own settings', async () => {
      const grandmother = await parent({ name: '周秀英' });
      const own = await createFamily(server, grandmother, { name: '周家', timezone: 'UTC' });
      const other = await createFamily(server, await parent(), {
        name: '外孙家',
        timezone: 'Asia/Shanghai',
      });
      await addMember(started.databaseUrl, other.id, grandmother.id);

      const me = meResponseSchema.parse((await asParent(grandmother).get('/api/me')).body);
      expect(me.families).toEqual([
        { id: own.id, name: '周家', role: 'admin', pendingRequests: 0 },
        { id: other.id, name: '外孙家', role: 'member' },
      ]);
      const details = await Promise.all(
        [own.id, other.id].map(async (familyId) =>
          familyDetailSchema.parse(
            (await asParent(grandmother).get(`/api/families/${familyId}`)).body,
          ),
        ),
      );
      expect(
        details.map(({ name, timezone, code, role }) => ({ name, timezone, code, role })),
      ).toEqual([
        { name: '周家', timezone: 'UTC', code: own.code, role: 'admin' },
        { name: '外孙家', timezone: 'Asia/Shanghai', code: other.code, role: 'member' },
      ]);
    });
  });

  // .docs/design/rules.md, "同时操作": changes at the same moment run one after
  // another, and the later one sees what the earlier one left.
  describe('changes at the same time', () => {
    it('hands the admin role to only one of two members at once', async () => {
      const { family, admin, member } = await familyWithMember();
      const third = await parent();
      await addMember(started.databaseUrl, family.id, third.id);

      const responses = await Promise.all(
        [member, third].map(({ id }) =>
          asParent(admin).put(`/api/families/${family.id}/admin`, { parentId: id }),
        ),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 403]);
      const refused = responses.filter(({ status }) => status === 403);
      expect(outcomesOf(refused)).toEqual([[403, 'not_admin']]);
      const roles = (await members(family.id)).map(({ role }) => role);
      expect(roles.filter((role) => role === 'admin')).toHaveLength(1);
      expect(roles[0]).toBe('member');
    });

    it('either hands the admin role over or takes the member out, never both', async () => {
      const { family, admin, member } = await familyWithMember();

      const [transfer, removal] = await Promise.all([
        asParent(admin).put(`/api/families/${family.id}/admin`, { parentId: member.id }),
        asParent(admin).delete(`/api/families/${family.id}/members/${member.id}`),
      ]);

      const handedOver = {
        statuses: [200, 403],
        members: [
          { parent_id: admin.id, role: 'member' },
          { parent_id: member.id, role: 'admin' },
        ],
      };
      const takenOut = {
        statuses: [409, 204],
        members: [{ parent_id: admin.id, role: 'admin' }],
      };
      expect([handedOver, takenOut]).toContainEqual({
        statuses: [transfer.status, removal.status],
        members: await members(family.id),
      });
    });

    it('takes a member out once when the admin does it twice at once', async () => {
      const { family, admin, member } = await familyWithMember();

      const responses = await Promise.all(
        [1, 2].map(() => asParent(admin).delete(`/api/families/${family.id}/members/${member.id}`)),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([204, 409]);
      expect(await members(family.id)).toEqual([{ parent_id: admin.id, role: 'admin' }]);
    });
  });
});
