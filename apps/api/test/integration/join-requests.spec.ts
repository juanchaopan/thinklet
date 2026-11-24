import {
  applicantJoinRequestListSchema,
  applicantJoinRequestSchema,
  familyDetailSchema,
  familyJoinRequestsResponseSchema,
  handledJoinRequestSchema,
  meResponseSchema,
  type ApplicantJoinRequest,
  type FamilyDetail,
  type FamilyJoinRequestsResponse,
} from '@thinklet/contracts';
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

// Acceptance criteria covered: parent B enters the code of parent A's family,
// sees the family's name and its admin's name and applies; A's menu then
// counts the pending request and A sees B's request among the family's
// pending requests; after A approves, B is in the family and sees the
// approval; after A rejects, B is not and sees the rejection on the start
// page; either way the request leaves A's list, which holds pending requests
// alone; B's results not yet seen are counted for the red dot; a withdrawn
// request disappears from A's list; B's 「知道了」 clears the request from
// B's list only; after A changes the code, the old code no longer works and
// the pending requests made with it expire. The admin's list and the code
// lookup carry the parent ids the avatars take their colours from. The
// admin has no 「知道了」 of their own: its route does not exist.
describe('join requests', () => {
  const running = useAppWithServices();

  const parent = (claims?: Record<string, unknown>) => signInParent(running.server, claims);
  const asParent = (someone: Parent) => as(running.server, someone);
  const apply = (someone: Parent, code: string) => applyToFamily(running.server, someone, code);
  const newFamily = (admin: Parent, body?: { name: string; timezone: string }) =>
    createFamily(running.server, admin, body);
  const row = (requestId: string) => joinRequestRow(running.databaseUrl, requestId);
  const rows = (familyId: string) => joinRequestRows(running.databaseUrl, familyId);
  const members = (familyId: string) => memberRows(running.databaseUrl, familyId);

  const decide = (admin: Parent, familyId: string, requestId: string, decision: string) =>
    asParent(admin).post(`/api/families/${familyId}/join-requests/${requestId}/${decision}`);
  const withdraw = (applicant: Parent, requestId: string) =>
    asParent(applicant).delete(`/api/join-requests/${requestId}`);
  const dismissOwn = (applicant: Parent, requestId: string) =>
    asParent(applicant).post(`/api/join-requests/${requestId}/dismiss`);
  const changeCode = (admin: Parent, familyId: string) =>
    asParent(admin).post(`/api/families/${familyId}/code`);

  /** A family with its admin, 林悦, and a parent, 陈晓, who is not in it yet. */
  async function familyAndApplicant(): Promise<{
    family: FamilyDetail;
    admin: Parent;
    applicant: Parent;
  }> {
    const admin = await parent({ name: '林悦', email: 'linyue@example.com' });
    const applicant = await parent({ name: '陈晓', email: 'chenxiao@example.com' });
    const family = await newFamily(admin);
    return { family, admin, applicant };
  }

  /** 陈晓's request to 林悦's family, which 林悦 rejected. */
  async function rejectedRequest() {
    const { family, admin, applicant } = await familyAndApplicant();
    const request = await apply(applicant, family.code);
    await decide(admin, family.id, request.id, 'reject');
    return { family, admin, applicant, request };
  }

  /** New parents with the names, each applying to the family in turn, with their requests. */
  async function applicantsOf(family: FamilyDetail, names: string[]) {
    const applied: Array<{ applicant: Parent; request: ApplicantJoinRequest }> = [];
    for (const name of names) {
      const applicant = await parent({ name });
      applied.push({ applicant, request: await apply(applicant, family.code) });
    }
    return applied;
  }

  /**
   * A family for each name, "<name>家" with "<name>" as its admin, and the
   * applicant's request to each of them in turn.
   */
  async function requestsToFamilies(applicant: Parent, names: string[]) {
    const applied: Array<{ admin: Parent; family: FamilyDetail; request: ApplicantJoinRequest }> =
      [];
    for (const name of names) {
      const admin = await parent({ name });
      const family = await newFamily(admin, { name: `${name}家`, timezone: 'UTC' });
      applied.push({ admin, family, request: await apply(applicant, family.code) });
    }
    return applied;
  }

  async function adminList(admin: Parent, familyId: string): Promise<FamilyJoinRequestsResponse> {
    const response = await asParent(admin).get(`/api/families/${familyId}/join-requests`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return familyJoinRequestsResponseSchema.parse(response.body);
  }

  async function ownList(applicant: Parent): Promise<ApplicantJoinRequest[]> {
    const response = await asParent(applicant).get('/api/join-requests');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return applicantJoinRequestListSchema.parse(response.body);
  }

  async function pendingCount(admin: Parent, familyId: string): Promise<number | undefined> {
    const me = meResponseSchema.parse((await asParent(admin).get('/api/me')).body);
    return me.families.find(({ id }) => id === familyId)?.pendingRequests;
  }

  async function requestResults(applicant: Parent): Promise<number> {
    return meResponseSchema.parse((await asParent(applicant).get('/api/me')).body).requestResults;
  }

  describe('GET /api/family-codes/{code}', () => {
    it("shows the family's name and its admin's name and parent id, whatever the case of the code", async () => {
      const { family, admin, applicant } = await familyAndApplicant();

      const responses = [
        await asParent(applicant).get(`/api/family-codes/${family.code}`),
        await asParent(applicant).get(`/api/family-codes/${family.code.toLowerCase()}`),
      ];

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toEqual({
          familyName: '林悦的家',
          adminName: '林悦',
          adminId: admin.id,
        });
      }
    });

    it('names the admin of the moment after the admin role was handed over', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const member = await parent({ name: '周子航' });
      await addMember(running.databaseUrl, family.id, member.id);
      await asParent(admin).put(`/api/families/${family.id}/admin`, { parentId: member.id });

      const response = await asParent(applicant).get(`/api/family-codes/${family.code}`);

      expect(response.body).toEqual({
        familyName: '林悦的家',
        adminName: '周子航',
        adminId: member.id,
      });
    });

    it('answers a code no family has, or that cannot be one, with 404 code_not_found', async () => {
      const { applicant } = await familyAndApplicant();
      const codes = ['222222', 'ABC', '0OIL11', '2345678'];

      const responses = await Promise.all(
        codes.map((code) => asParent(applicant).get(`/api/family-codes/${code}`)),
      );

      expect(outcomesOf(responses)).toEqual(codes.map(() => [404, 'code_not_found']));
    });

    it('answers a member, the admin too, with 409 already_member', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      await addMember(running.databaseUrl, family.id, applicant.id);

      const responses = [
        await asParent(applicant).get(`/api/family-codes/${family.code}`),
        await asParent(admin).get(`/api/family-codes/${family.code}`),
      ];

      expect(outcomesOf(responses)).toEqual([
        [409, 'already_member'],
        [409, 'already_member'],
      ]);
    });

    it('answers a parent with a pending request with 409 request_pending', async () => {
      const { family, applicant } = await familyAndApplicant();
      await apply(applicant, family.code);

      const response = await asParent(applicant).get(`/api/family-codes/${family.code}`);

      expect(outcomesOf([response])).toEqual([[409, 'request_pending']]);
    });

    it('lets a parent whose request was rejected look the code up again', async () => {
      const { family, applicant } = await rejectedRequest();

      const response = await asParent(applicant).get(`/api/family-codes/${family.code}`);

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/join-requests', () => {
    it('records a pending request with the code, which the admin counts and sees', async () => {
      const { family, admin, applicant } = await familyAndApplicant();

      const response = await asParent(applicant).post('/api/join-requests', {
        code: family.code.toLowerCase(),
      });

      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      const created = applicantJoinRequestSchema.parse(response.body);
      expect(created).toMatchObject({
        familyName: '林悦的家',
        familyTimezone: 'Asia/Shanghai',
        adminName: '林悦',
        status: 'pending',
      });
      const stored = await row(created.id);
      expect(stored).toMatchObject({
        family_id: family.id,
        parent_id: applicant.id,
        code: family.code,
        status: 'pending',
        closed_at: null,
        closed_by: null,
      });
      expect(created.createdAt).toBe(stored.created_at.toISOString());
      expect(await pendingCount(admin, family.id)).toBe(1);
      expect(await adminList(admin, family.id)).toEqual({
        pending: [
          {
            id: created.id,
            parentId: applicant.id,
            name: '陈晓',
            email: 'chenxiao@example.com',
            createdAt: created.createdAt,
          },
        ],
      });
      expect(await requestResults(applicant)).toBe(0);
    });

    it('refuses a second request to the same family with 409 request_pending', async () => {
      const { family, applicant } = await familyAndApplicant();
      await apply(applicant, family.code);

      const response = await asParent(applicant).post('/api/join-requests', { code: family.code });

      expect(outcomesOf([response])).toEqual([[409, 'request_pending']]);
      expect(await rows(family.id)).toHaveLength(1);
    });

    it('records only one of two requests made at the same time', async () => {
      const { family, applicant } = await familyAndApplicant();

      const responses = await Promise.all(
        [1, 2].map(() => asParent(applicant).post('/api/join-requests', { code: family.code })),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect(outcomesOf(responses.filter(({ status }) => status === 409))).toEqual([
        [409, 'request_pending'],
      ]);
      expect(await rows(family.id)).toHaveLength(1);
    });

    it('refuses members with 409 already_member and an unknown code with 404 code_not_found', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      await addMember(running.databaseUrl, family.id, applicant.id);

      const responses = [
        await asParent(applicant).post('/api/join-requests', { code: family.code }),
        await asParent(admin).post('/api/join-requests', { code: family.code }),
        await asParent(await parent()).post('/api/join-requests', { code: '222222' }),
      ];

      expect(outcomesOf(responses)).toEqual([
        [409, 'already_member'],
        [409, 'already_member'],
        [404, 'code_not_found'],
      ]);
      expect(await rows(family.id)).toEqual([]);
    });

    it.each([
      [{}, [{ path: 'code', code: 'required' }]],
      [{ code: 'ABC' }, [{ path: 'code', code: 'invalid' }]],
      [{ code: 7 }, [{ path: 'code', code: 'invalid' }]],
    ])('refuses %j with 400 and the fields', async (body, fields) => {
      const response = await asParent(await parent()).post('/api/join-requests', body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'invalid_request', fields } });
    });

    it('lets a parent apply to two families at once', async () => {
      const { family, applicant } = await familyAndApplicant();
      const other = await newFamily(await parent(), { name: '外婆家', timezone: 'Europe/London' });

      await apply(applicant, family.code);
      await apply(applicant, other.code);

      expect(
        (await ownList(applicant)).map(({ familyName, familyTimezone }) => ({
          familyName,
          familyTimezone,
        })),
      ).toEqual([
        { familyName: '外婆家', familyTimezone: 'Europe/London' },
        { familyName: '林悦的家', familyTimezone: 'Asia/Shanghai' },
      ]);
    });
  });

  describe('GET /api/join-requests', () => {
    it('lists the pending, approved, rejected and expired requests newest first, not the withdrawn', async () => {
      const applicant = await parent();
      const applied = await requestsToFamilies(applicant, ['甲', '乙', '丙', '丁', '戊']);
      const [pending, rejected, expired, approved, withdrawn] = applied;
      if (!pending || !rejected || !expired || !approved || !withdrawn) {
        throw new Error('Five requests were made');
      }
      await decide(rejected.admin, rejected.family.id, rejected.request.id, 'reject');
      await changeCode(expired.admin, expired.family.id);
      await decide(approved.admin, approved.family.id, approved.request.id, 'approve');
      await withdraw(applicant, withdrawn.request.id);

      const listed = await ownList(applicant);

      expect(listed).toEqual([
        { ...approved.request, status: 'approved' },
        { ...expired.request, status: 'expired' },
        { ...rejected.request, status: 'rejected' },
        pending.request,
      ]);
      expect(listed.map(({ familyName, adminName }) => [familyName, adminName])).toEqual([
        ['丁家', '丁'],
        ['丙家', '丙'],
        ['乙家', '乙'],
        ['甲家', '甲'],
      ]);
    });

    it('is empty for a parent with no requests', async () => {
      expect(await ownList(await parent())).toEqual([]);
    });
  });

  describe('the request results in GET /api/me', () => {
    it("counts the parent's approved, rejected and expired requests not yet dismissed", async () => {
      const applicant = await parent();
      const applied = await requestsToFamilies(applicant, ['甲', '乙', '丙', '丁', '戊', '己']);
      const [pending, approved, rejected, expired, withdrawn, dismissed] = applied;
      if (!pending || !approved || !rejected || !expired || !withdrawn || !dismissed) {
        throw new Error('Six requests were made');
      }
      expect(await requestResults(applicant)).toBe(0);

      await decide(approved.admin, approved.family.id, approved.request.id, 'approve');
      await decide(rejected.admin, rejected.family.id, rejected.request.id, 'reject');
      await changeCode(expired.admin, expired.family.id);
      await withdraw(applicant, withdrawn.request.id);
      await decide(dismissed.admin, dismissed.family.id, dismissed.request.id, 'reject');
      await dismissOwn(applicant, dismissed.request.id);

      expect(await requestResults(applicant)).toBe(3);

      await dismissOwn(applicant, approved.request.id);

      expect(await requestResults(applicant)).toBe(2);
    });

    it("does not count other parents' results", async () => {
      const { admin, applicant } = await rejectedRequest();

      expect(await requestResults(applicant)).toBe(1);
      expect(await requestResults(admin)).toBe(0);
    });

    it('is in the answer of PATCH /api/me as well', async () => {
      const { applicant } = await rejectedRequest();

      const response = await asParent(applicant).patch('/api/me', { name: '陈小晓' });

      expect(response.status).toBe(200);
      expect(meResponseSchema.parse(response.body)).toMatchObject({
        name: '陈小晓',
        requestResults: 1,
      });
    });
  });

  describe('DELETE /api/join-requests/{requestId}', () => {
    it('withdraws the request, which disappears from both sides and from the count', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const response = await withdraw(applicant, request.id);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      const stored = await row(request.id);
      expect(stored).toMatchObject({ status: 'withdrawn', closed_by: null });
      expect(stored.closed_at).toBeInstanceOf(Date);
      expect(await adminList(admin, family.id)).toEqual({ pending: [] });
      expect(await ownList(applicant)).toEqual([]);
      expect(await pendingCount(admin, family.id)).toBe(0);
      expect(await requestResults(applicant)).toBe(0);
    });

    it('lets the parent apply again after withdrawing', async () => {
      const { family, applicant } = await familyAndApplicant();
      const first = await apply(applicant, family.code);
      await withdraw(applicant, first.id);

      const second = await apply(applicant, family.code);

      expect(second.id).not.toBe(first.id);
      expect((await ownList(applicant)).map(({ id }) => id)).toEqual([second.id]);
    });

    it('refuses a request already withdrawn, approved or rejected with 409 request_closed', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const withdrawn = await apply(applicant, family.code);
      await withdraw(applicant, withdrawn.id);
      const rejected = await apply(applicant, family.code);
      await decide(admin, family.id, rejected.id, 'reject');
      const approved = await apply(applicant, family.code);
      await decide(admin, family.id, approved.id, 'approve');

      const responses = await Promise.all(
        [withdrawn, rejected, approved].map(({ id }) => withdraw(applicant, id)),
      );

      expect(outcomesOf(responses)).toEqual(responses.map(() => [409, 'request_closed']));
      expect((await rows(family.id)).map(({ status }) => status)).toEqual([
        'withdrawn',
        'rejected',
        'approved',
      ]);
    });

    it('answers a request that does not exist, or an id that is not one, with 404 not_found', async () => {
      const applicant = await parent();

      const responses = [
        await withdraw(applicant, crypto.randomUUID()),
        await withdraw(applicant, 'not-an-id'),
      ];

      expect(outcomesOf(responses)).toEqual([
        [404, 'not_found'],
        [404, 'not_found'],
      ]);
    });
  });

  describe('POST /api/join-requests/{requestId}/dismiss', () => {
    it("clears a rejected request from the applicant's list, which the admin's list never held", async () => {
      const { family, admin, applicant, request } = await rejectedRequest();

      const response = await dismissOwn(applicant, request.id);

      expect(response.status).toBe(204);
      expect(await ownList(applicant)).toEqual([]);
      expect((await row(request.id)).dismissed_by_applicant_at).toBeInstanceOf(Date);
      expect(await adminList(admin, family.id)).toEqual({ pending: [] });
    });

    it("clears an approved request from the applicant's list, leaving the membership", async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);
      await decide(admin, family.id, request.id, 'approve');

      const response = await dismissOwn(applicant, request.id);

      expect(response.status).toBe(204);
      expect(await ownList(applicant)).toEqual([]);
      expect(await requestResults(applicant)).toBe(0);
      expect(await members(family.id)).toEqual([
        { parent_id: admin.id, role: 'admin' },
        { parent_id: applicant.id, role: 'member' },
      ]);
    });

    it('clears an expired request and keeps the first time when cleared twice', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);
      await changeCode(admin, family.id);

      await dismissOwn(applicant, request.id);
      const first = (await row(request.id)).dismissed_by_applicant_at;
      const again = await dismissOwn(applicant, request.id);

      expect(again.status).toBe(204);
      expect(first).toBeInstanceOf(Date);
      expect((await row(request.id)).dismissed_by_applicant_at).toEqual(first);
      expect(await ownList(applicant)).toEqual([]);
    });

    it('refuses a pending request with 409 request_pending', async () => {
      const { family, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const response = await dismissOwn(applicant, request.id);

      expect(outcomesOf([response])).toEqual([[409, 'request_pending']]);
      expect((await row(request.id)).dismissed_by_applicant_at).toBeNull();
    });

    it('answers a withdrawn request, which the applicant is not shown, with 404 not_found', async () => {
      const { family, applicant } = await familyAndApplicant();
      const withdrawn = await apply(applicant, family.code);
      await withdraw(applicant, withdrawn.id);

      const responses = [
        await dismissOwn(applicant, withdrawn.id),
        await dismissOwn(applicant, crypto.randomUUID()),
        await dismissOwn(applicant, 'not-an-id'),
      ];

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'not_found']));
      expect((await row(withdrawn.id)).dismissed_by_applicant_at).toBeNull();
    });
  });

  describe('GET /api/families/{familyId}/join-requests', () => {
    it('lists only the pending requests, newest first', async () => {
      const { family, admin } = await familyAndApplicant();
      const applied = await applicantsOf(family, ['甲', '乙', '丙', '丁', '戊']);
      const [first, second, approved, rejected, withdrawn] = applied;
      if (!first || !second || !approved || !rejected || !withdrawn) {
        throw new Error('Five requests were made');
      }
      await decide(admin, family.id, approved.request.id, 'approve');
      await decide(admin, family.id, rejected.request.id, 'reject');
      await withdraw(withdrawn.applicant, withdrawn.request.id);

      expect(await adminList(admin, family.id)).toEqual({
        pending: [
          {
            id: second.request.id,
            parentId: second.applicant.id,
            name: '乙',
            email: null,
            createdAt: second.request.createdAt,
          },
          {
            id: first.request.id,
            parentId: first.applicant.id,
            name: '甲',
            email: null,
            createdAt: first.request.createdAt,
          },
        ],
      });
      expect(await pendingCount(admin, family.id)).toBe(2);
    });

    it("does not list another family's requests", async () => {
      const { family, admin } = await familyAndApplicant();
      const other = await newFamily(await parent());
      await apply(await parent(), other.code);

      expect(await adminList(admin, family.id)).toEqual({ pending: [] });
    });
  });

  describe("the admin's 「知道了」", () => {
    it('does not exist: its route answers 404 not_found and changes nothing', async () => {
      const { family, admin, applicant, request } = await rejectedRequest();
      const before = await row(request.id);

      const response = await asParent(admin).post(
        `/api/families/${family.id}/join-requests/${request.id}/dismiss`,
      );

      expect(outcomesOf([response])).toEqual([[404, 'not_found']]);
      expect(await row(request.id)).toEqual(before);
      expect(await ownList(applicant)).toEqual([{ ...request, status: 'rejected' }]);
    });
  });

  describe('POST /api/families/{familyId}/join-requests/{requestId}/approve', () => {
    it('makes the applicant a member of the family, who sees the approval', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const response = await decide(admin, family.id, request.id, 'approve');

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const stored = await row(request.id);
      expect(handledJoinRequestSchema.parse(response.body)).toEqual({
        id: request.id,
        parentId: applicant.id,
        name: '陈晓',
        email: 'chenxiao@example.com',
        status: 'approved',
        closedAt: stored.closed_at?.toISOString(),
      });
      expect(stored).toMatchObject({ status: 'approved', closed_by: admin.id });
      expect(await members(family.id)).toEqual([
        { parent_id: admin.id, role: 'admin' },
        { parent_id: applicant.id, role: 'member' },
      ]);
      const opened = await asParent(applicant).get(`/api/families/${family.id}`);
      expect(familyDetailSchema.parse(opened.body)).toMatchObject({ role: 'member' });
      const me = meResponseSchema.parse((await asParent(applicant).get('/api/me')).body);
      expect(me.families).toEqual([{ id: family.id, name: '林悦的家', role: 'member' }]);
      expect(me.requestResults).toBe(1);
      expect(await ownList(applicant)).toEqual([{ ...request, status: 'approved' }]);
      expect(await pendingCount(admin, family.id)).toBe(0);
      expect(await adminList(admin, family.id)).toEqual({ pending: [] });
    });

    it('refuses a request already withdrawn, handled or expired with 409 request_closed', async () => {
      const { family, admin } = await familyAndApplicant();
      const [withdrawn, rejected, approved, expired] = await applicantsOf(family, [
        '甲',
        '乙',
        '丙',
        '丁',
      ]);
      if (!withdrawn || !rejected || !approved || !expired) {
        throw new Error('Four requests were made');
      }
      await withdraw(withdrawn.applicant, withdrawn.request.id);
      await decide(admin, family.id, rejected.request.id, 'reject');
      await decide(admin, family.id, approved.request.id, 'approve');
      await changeCode(admin, family.id);
      const membersBefore = await members(family.id);

      const responses = [];
      for (const { request } of [withdrawn, rejected, approved, expired]) {
        responses.push(await decide(admin, family.id, request.id, 'approve'));
        responses.push(await decide(admin, family.id, request.id, 'reject'));
      }

      expect(outcomesOf(responses)).toEqual(responses.map(() => [409, 'request_closed']));
      expect(await members(family.id)).toEqual(membersBefore);
      expect((await rows(family.id)).map(({ status }) => status)).toEqual([
        'withdrawn',
        'rejected',
        'approved',
        'expired',
      ]);
    });

    it('answers a request of another family, or none, with 404 not_found', async () => {
      const { family, admin } = await familyAndApplicant();
      const other = await newFamily(await parent());
      const theirs = await apply(await parent(), other.code);

      const responses = [
        await decide(admin, family.id, theirs.id, 'approve'),
        await decide(admin, family.id, theirs.id, 'reject'),
        await decide(admin, family.id, crypto.randomUUID(), 'approve'),
        await decide(admin, family.id, 'not-an-id', 'approve'),
      ];

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'not_found']));
      expect((await row(theirs.id)).status).toBe('pending');
      expect(await members(family.id)).toHaveLength(1);
    });
  });

  describe('POST /api/families/{familyId}/join-requests/{requestId}/reject', () => {
    it('keeps the applicant out, who sees the rejection', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const response = await decide(admin, family.id, request.id, 'reject');

      expect(response.status).toBe(200);
      expect(handledJoinRequestSchema.parse(response.body)).toMatchObject({
        id: request.id,
        parentId: applicant.id,
        status: 'rejected',
      });
      expect(await row(request.id)).toMatchObject({ status: 'rejected', closed_by: admin.id });
      expect(await members(family.id)).toEqual([{ parent_id: admin.id, role: 'admin' }]);
      const opened = await asParent(applicant).get(`/api/families/${family.id}`);
      expect(outcomesOf([opened])).toEqual([[404, 'family_not_found']]);
      expect(await ownList(applicant)).toEqual([{ ...request, status: 'rejected' }]);
      expect(await requestResults(applicant)).toBe(1);
      expect(await adminList(admin, family.id)).toEqual({ pending: [] });
    });
  });

  describe('changing the family code', () => {
    it('expires the pending requests, which both sides see, and the old code stops working', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const changed = familyDetailSchema.parse((await changeCode(admin, family.id)).body);

      expect(await ownList(applicant)).toEqual([{ ...request, status: 'expired' }]);
      expect(await requestResults(applicant)).toBe(1);
      expect(await adminList(admin, family.id)).toEqual({ pending: [] });
      expect(await pendingCount(admin, family.id)).toBe(0);
      const stranger = await parent();
      const withOldCode = [
        await asParent(applicant).get(`/api/family-codes/${family.code}`),
        await asParent(applicant).post('/api/join-requests', { code: family.code }),
        await asParent(stranger).get(`/api/family-codes/${family.code}`),
        await asParent(stranger).post('/api/join-requests', { code: family.code }),
      ];
      expect(outcomesOf(withOldCode)).toEqual(withOldCode.map(() => [404, 'code_not_found']));
      const again = await apply(applicant, changed.code);
      expect(again).toMatchObject({ familyName: '林悦的家', status: 'pending' });
      expect((await row(again.id)).code).toBe(changed.code);
    });
  });

  // .docs/design/rules.md, "同时操作": changes to a request at the same moment
  // run one after another, and the later one sees what the earlier one left.
  describe('changes at the same time', () => {
    it('either approves or withdraws a request, never both', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const [approval, withdrawal] = await Promise.all([
        decide(admin, family.id, request.id, 'approve'),
        withdraw(applicant, request.id),
      ]);

      const approved = {
        statuses: [200, 409],
        status: 'approved',
        members: [
          { parent_id: admin.id, role: 'admin' },
          { parent_id: applicant.id, role: 'member' },
        ],
      };
      const withdrawn = {
        statuses: [409, 204],
        status: 'withdrawn',
        members: [{ parent_id: admin.id, role: 'admin' }],
      };
      expect([approved, withdrawn]).toContainEqual({
        statuses: [approval.status, withdrawal.status],
        status: (await row(request.id)).status,
        members: await members(family.id),
      });
      const refused = [approval, withdrawal].filter(({ status }) => status === 409);
      expect(outcomesOf(refused)).toEqual([[409, 'request_closed']]);
    });

    it('approves a request once when it is approved twice at once', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const responses = await Promise.all(
        [1, 2].map(() => decide(admin, family.id, request.id, 'approve')),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(outcomesOf(responses.filter(({ status }) => status === 409))).toEqual([
        [409, 'request_closed'],
      ]);
      expect(await members(family.id)).toHaveLength(2);
    });

    it('either approves or rejects a request, never both', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const responses = await Promise.all(
        ['approve', 'reject'].map((decision) => decide(admin, family.id, request.id, decision)),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      const winner = responses.find(({ status }) => status === 200);
      const { status } = handledJoinRequestSchema.parse(winner?.body);
      expect((await row(request.id)).status).toBe(status);
      expect(await members(family.id)).toHaveLength(status === 'approved' ? 2 : 1);
    });

    it('either approves a request or expires it with the new code, never both', async () => {
      const { family, admin, applicant } = await familyAndApplicant();
      const request = await apply(applicant, family.code);

      const [approval, change] = await Promise.all([
        decide(admin, family.id, request.id, 'approve'),
        changeCode(admin, family.id),
      ]);

      expect(change.status).toBe(200);
      expect([
        { approval: 200, status: 'approved', members: 2 },
        { approval: 409, status: 'expired', members: 1 },
      ]).toContainEqual({
        approval: approval.status,
        status: (await row(request.id)).status,
        members: (await members(family.id)).length,
      });
    });

    it('either records a request with the old code and expires it, or refuses the old code', async () => {
      const { family, admin, applicant } = await familyAndApplicant();

      const [application] = await Promise.all([
        asParent(applicant).post('/api/join-requests', { code: family.code }),
        changeCode(admin, family.id),
      ]);

      const statuses = (await rows(family.id)).map(({ status }) => status);
      expect([
        { application: 201, statuses: ['expired'] },
        { application: 404, statuses: [] },
      ]).toContainEqual({ application: application.status, statuses });
    });
  });
});
