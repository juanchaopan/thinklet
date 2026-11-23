import {
  applicantJoinRequestListSchema,
  familyJoinRequestsResponseSchema,
  meResponseSchema,
  type ApplicantJoinRequest,
  type FamilyDetail,
} from '@thinklet/contracts';
import request from 'supertest';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import {
  addMember,
  applyToFamily,
  as,
  createFamily,
  joinRequestRow,
  joinRequestRows,
  memberRows,
  outcomesOf,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { cookieHeader } from '../support/login.js';

/** A family with its admin, one member and one applicant whose request is pending. */
interface Household {
  family: FamilyDetail;
  admin: Parent;
  member: Parent;
  applicant: Parent;
  pending: ApplicantJoinRequest;
}

// Security test cases of .docs/architecture.md ("指标和要求", 安全) for join
// requests: a parent cannot see, withdraw or dismiss someone else's request,
// approved ones included, and counts only their own results; only the
// family's admin can see, approve or reject the family's requests, a member
// who is not the admin is refused and a parent who is not a member is
// answered as if there were no such family; a request of another family is
// refused on a family's routes; a code lookup and the admin's list tell no
// more than the design gives them; every route needs a login and the changes
// need this site's Origin.
describe('join request security', () => {
  const running = useAppWithServices();
  let ours: Household;
  let theirs: Household;

  async function household(name: string): Promise<Household> {
    const signIn = (claims: Record<string, unknown>) => signInParent(running.server, claims);
    const admin = await signIn({ name: `${name}管理员` });
    const member = await signIn({ name: `${name}家长` });
    const applicant = await signIn({ name: `${name}申请人`, email: 'applicant@example.com' });
    const family = await createFamily(running.server, admin, { name, timezone: 'Asia/Shanghai' });
    await addMember(running.databaseUrl, family.id, member.id);
    const pending = await applyToFamily(running.server, applicant, family.code);
    return { family, admin, member, applicant, pending };
  }

  /** Everything the database holds about the family's members and requests. */
  async function stateOf(familyId: string) {
    return {
      members: await memberRows(running.databaseUrl, familyId),
      requests: await joinRequestRows(running.databaseUrl, familyId),
    };
  }

  /** Every admin route of the target's family, on the given request, sent by the parent. */
  async function adminRoutes(
    by: Parent,
    target: Household,
    requestId: string,
  ): Promise<request.Response[]> {
    const client = as(running.server, by);
    const path = `/api/families/${target.family.id}/join-requests`;
    return [
      await client.get(path),
      await client.post(`${path}/${requestId}/approve`),
      await client.post(`${path}/${requestId}/reject`),
    ];
  }

  beforeAll(async () => {
    ours = await household('我们家');
    theirs = await household('他们家');
  });

  it("answers another parent's request as not found when withdrawing or dismissing it", async () => {
    const before = await stateOf(theirs.family.id);

    const responses = [];
    for (const by of [ours.applicant, ours.admin, theirs.admin, theirs.member]) {
      const client = as(running.server, by);
      responses.push(await client.delete(`/api/join-requests/${theirs.pending.id}`));
      responses.push(await client.post(`/api/join-requests/${theirs.pending.id}/dismiss`));
    }

    expect(responses.map((response): unknown[] => [response.status, response.body])).toEqual(
      responses.map(({ headers }) => [
        404,
        { error: { code: 'not_found', requestId: headers['x-request-id'] } },
      ]),
    );
    expect(await stateOf(theirs.family.id)).toEqual(before);
  });

  it('does not let anyone else dismiss an approved request, nor count it as their result', async () => {
    const approved = await household('第三家');
    await as(running.server, approved.admin).post(
      `/api/families/${approved.family.id}/join-requests/${approved.pending.id}/approve`,
    );

    const responses = [];
    for (const by of [approved.admin, approved.member, ours.applicant]) {
      responses.push(
        await as(running.server, by).post(`/api/join-requests/${approved.pending.id}/dismiss`),
      );
    }

    expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'not_found']));
    expect((await joinRequestRow(running.databaseUrl, approved.pending.id)).status).toBe(
      'approved',
    );
    expect(
      (await joinRequestRow(running.databaseUrl, approved.pending.id)).dismissed_by_applicant_at,
    ).toBeNull();
    const results = await Promise.all(
      [approved.applicant, approved.admin, ours.applicant].map(
        async (by) =>
          meResponseSchema.parse((await as(running.server, by).get('/api/me')).body).requestResults,
      ),
    );
    expect(results).toEqual([1, 0, 0]);
  });

  it("lists only the parent's own requests", async () => {
    const lists = await Promise.all(
      [ours.applicant, ours.admin, theirs.member].map(async (by) =>
        applicantJoinRequestListSchema.parse(
          (await as(running.server, by).get('/api/join-requests')).body,
        ),
      ),
    );

    expect(lists.map((list) => list.map(({ id }) => id))).toEqual([[ours.pending.id], [], []]);
  });

  it("tells a parent who looks a code up only the family's name and its admin's name and id", async () => {
    const response = await as(running.server, await signInParent(running.server)).get(
      `/api/family-codes/${ours.family.code}`,
    );

    expect(response.body).toEqual({
      familyName: '我们家',
      adminName: '我们家管理员',
      adminId: ours.admin.id,
    });
  });

  it("gives the admin each applicant's own parent id, with nobody else's", async () => {
    const listed = familyJoinRequestsResponseSchema.parse(
      (await as(running.server, ours.admin).get(`/api/families/${ours.family.id}/join-requests`))
        .body,
    );

    expect(listed.pending.map(({ id, parentId }) => ({ id, parentId }))).toEqual([
      { id: ours.pending.id, parentId: ours.applicant.id },
    ]);
  });

  it('answers a member who is not the admin with 403 not_admin on every admin route', async () => {
    const before = await stateOf(ours.family.id);

    const responses = await adminRoutes(ours.member, ours, ours.pending.id);

    expect(outcomesOf(responses)).toEqual(responses.map(() => [403, 'not_admin']));
    expect(await stateOf(ours.family.id)).toEqual(before);
  });

  it.each([
    ['the admin', 'admin'],
    ['a member', 'member'],
    ['an applicant', 'applicant'],
  ] as const)(
    'answers %s of another family with 404 family_not_found on every admin route',
    async (_who, role) => {
      const before = await stateOf(theirs.family.id);

      const responses = await adminRoutes(ours[role], theirs, theirs.pending.id);

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'family_not_found']));
      expect(await stateOf(theirs.family.id)).toEqual(before);
    },
  );

  it('does not let the applicant handle their own request', async () => {
    const before = await stateOf(ours.family.id);

    const responses = await adminRoutes(ours.applicant, ours, ours.pending.id);

    expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'family_not_found']));
    expect(await stateOf(ours.family.id)).toEqual(before);
  });

  it("refuses another family's request on the admin's own family with 404 not_found", async () => {
    const before = await stateOf(theirs.family.id);
    const client = as(running.server, ours.admin);
    const path = `/api/families/${ours.family.id}/join-requests`;

    const responses = [
      await client.post(`${path}/${theirs.pending.id}/approve`),
      await client.post(`${path}/${theirs.pending.id}/reject`),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'not_found']));
    expect(await stateOf(theirs.family.id)).toEqual(before);
    const listed = familyJoinRequestsResponseSchema.parse((await client.get(path)).body);
    expect(listed.pending.map(({ id }) => id)).toEqual([ours.pending.id]);
    const ourMembers = await memberRows(running.databaseUrl, ours.family.id);
    expect(ourMembers.map(({ parent_id }) => parent_id)).not.toContain(theirs.applicant.id);
  });

  it('refuses fields that would choose the family, the applicant or the status', async () => {
    const client = as(running.server, await signInParent(running.server));
    const code = ours.family.code;

    const responses = [
      await client.post('/api/join-requests', { code, familyId: theirs.family.id }),
      await client.post('/api/join-requests', { code, parentId: ours.member.id }),
      await client.post('/api/join-requests', { code, status: 'approved' }),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [400, 'invalid_request']));
  });

  it.each(["' or '1'='1", '%', '______', ' 2222 '])(
    'answers the code %j with 404 code_not_found',
    async (code) => {
      const response = await as(running.server, ours.applicant).get(
        `/api/family-codes/${encodeURIComponent(code)}`,
      );

      expect(outcomesOf([response])).toEqual([[404, 'code_not_found']]);
    },
  );

  it.each(["' or '1'='1", '00000000-0000-0000-0000-000000000000', 'null'])(
    'answers the request id %j with 404 not_found',
    async (requestId) => {
      const response = await as(running.server, ours.applicant).delete(
        `/api/join-requests/${encodeURIComponent(requestId)}`,
      );

      expect(outcomesOf([response])).toEqual([[404, 'not_found']]);
    },
  );

  it('needs a login on every join request route', async () => {
    const anonymous = (call: request.Test) => call.set('Origin', TEST_APP_ORIGIN);
    const server = () => request(running.server);
    const own = `/api/join-requests/${ours.pending.id}`;
    const family = `/api/families/${ours.family.id}/join-requests`;

    const responses = [
      await anonymous(server().get(`/api/family-codes/${ours.family.code}`)),
      await anonymous(server().post('/api/join-requests')).send({ code: ours.family.code }),
      await anonymous(server().get('/api/join-requests')),
      await anonymous(server().delete(own)),
      await anonymous(server().post(`${own}/dismiss`)),
      await anonymous(server().get(family)),
      await anonymous(server().post(`${family}/${ours.pending.id}/approve`)),
      await anonymous(server().post(`${family}/${ours.pending.id}/reject`)),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [401, 'unauthenticated']));
  });

  it("refuses changes from another site even with the parent's login", async () => {
    const before = await stateOf(ours.family.id);
    const fromElsewhere = (call: request.Test, by: Parent) =>
      call.set('Origin', 'https://evil.example').set('Cookie', cookieHeader(by.cookies));
    const server = () => request(running.server);
    const own = `/api/join-requests/${ours.pending.id}`;
    const family = `/api/families/${ours.family.id}/join-requests/${ours.pending.id}`;

    const responses = [
      await fromElsewhere(server().post('/api/join-requests'), theirs.member).send({
        code: ours.family.code,
      }),
      await fromElsewhere(server().delete(own), ours.applicant),
      await fromElsewhere(server().post(`${own}/dismiss`), ours.applicant),
      await fromElsewhere(server().post(`${family}/approve`), ours.admin),
      await fromElsewhere(server().post(`${family}/reject`), ours.admin),
    ];

    expect(outcomesOf(responses)).toEqual(responses.map(() => [403, 'bad_origin']));
    expect(await stateOf(ours.family.id)).toEqual(before);
  });
});
