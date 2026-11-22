import type { ErrorCode, FamilyRole, JoinRequestStatus } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import {
  RequestPendingError,
  type ApplicantRequestRecord,
  type Closing,
  type FamilyRequestRecord,
  type JoinRequestsRepository,
  type RequestState,
} from './join-requests.repository.js';
import {
  JoinRequestsService,
  requireAdminDismissal,
  requireApplicable,
  requireApplicantDismissal,
  requireDecision,
  requireWithdrawal,
  toApplicantRequest,
  toHandledRequest,
  toPendingRequest,
} from './join-requests.service.js';

const FAMILY_ID = 'family-1';
const OTHER_FAMILY_ID = 'family-2';
const ADMIN = 'parent-admin';
const APPLICANT = 'parent-applicant';
const STRANGER = 'parent-stranger';
const REQUEST_ID = 'request-1';
const CODE = '7KQ4MZ';

const STATUSES: JoinRequestStatus[] = ['pending', 'approved', 'rejected', 'withdrawn', 'expired'];

const CREATED_AT = new Date('2026-11-21T09:12:00Z');
const CLOSED_AT = new Date('2026-11-21T10:03:00Z');

/** The applicant's request to the family, in the given state. */
function requestIn(status: JoinRequestStatus): RequestState {
  return { familyId: FAMILY_ID, parentId: APPLICANT, status };
}

/** The error code a call throws, or undefined when it returns. */
function codeOf(call: () => unknown): ErrorCode | undefined {
  try {
    call();
  } catch (error) {
    if (error instanceof ApiError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

/** The error code a promise rejects with; fails when it resolves. */
async function rejectionCode(promise: Promise<unknown>): Promise<ErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('The call succeeded');
}

/** Each status with what the rule answers for it. */
function byStatus(
  expected: Partial<Record<JoinRequestStatus, ErrorCode>>,
): Array<[JoinRequestStatus, ErrorCode | undefined]> {
  return STATUSES.map((status) => [status, expected[status]]);
}

describe('requireApplicable', () => {
  it.each<[string, boolean, boolean, ErrorCode | undefined]>([
    ['a parent with no tie to the family', false, false, undefined],
    ['a member', true, false, 'already_member'],
    ['a parent with a pending request', false, true, 'request_pending'],
    ['a member with a pending request', true, true, 'already_member'],
  ])('answers %s with %s', (_who, member, pending, expected) => {
    expect(codeOf(() => requireApplicable({ member, pending }))).toBe(expected);
  });
});

describe('requireWithdrawal', () => {
  it.each(
    byStatus({
      approved: 'request_closed',
      rejected: 'request_closed',
      withdrawn: 'request_closed',
      expired: 'request_closed',
    }),
  )('answers the applicant withdrawing a %s request with %s', (status, expected) => {
    expect(codeOf(() => requireWithdrawal(requestIn(status), APPLICANT))).toBe(expected);
  });

  it('answers a request that does not exist or is not their own as not found', () => {
    expect(codeOf(() => requireWithdrawal(undefined, APPLICANT))).toBe('not_found');
    expect(codeOf(() => requireWithdrawal(requestIn('pending'), STRANGER))).toBe('not_found');
    expect(codeOf(() => requireWithdrawal(requestIn('approved'), STRANGER))).toBe('not_found');
  });
});

describe('requireDecision', () => {
  it.each(
    byStatus({
      approved: 'request_closed',
      rejected: 'request_closed',
      withdrawn: 'request_closed',
      expired: 'request_closed',
    }),
  )('answers the admin deciding a %s request with %s', (status, expected) => {
    expect(codeOf(() => requireDecision(requestIn(status), FAMILY_ID))).toBe(expected);
  });

  it('answers a request that does not exist or is of another family as not found', () => {
    expect(codeOf(() => requireDecision(undefined, FAMILY_ID))).toBe('not_found');
    expect(codeOf(() => requireDecision(requestIn('pending'), OTHER_FAMILY_ID))).toBe('not_found');
  });
});

describe('requireApplicantDismissal', () => {
  it.each(byStatus({ pending: 'request_pending', withdrawn: 'not_found' }))(
    'answers the applicant dismissing a %s request with %s',
    (status, expected) => {
      expect(codeOf(() => requireApplicantDismissal(requestIn(status), APPLICANT))).toBe(expected);
    },
  );

  it("answers someone else's request as not found, whatever its state", () => {
    expect(codeOf(() => requireApplicantDismissal(undefined, APPLICANT))).toBe('not_found');
    expect(codeOf(() => requireApplicantDismissal(requestIn('rejected'), STRANGER))).toBe(
      'not_found',
    );
    expect(codeOf(() => requireApplicantDismissal(requestIn('approved'), STRANGER))).toBe(
      'not_found',
    );
    expect(codeOf(() => requireApplicantDismissal(requestIn('pending'), STRANGER))).toBe(
      'not_found',
    );
  });
});

describe('requireAdminDismissal', () => {
  it.each(byStatus({ pending: 'request_pending', withdrawn: 'not_found' }))(
    'answers the admin dismissing a %s request with %s',
    (status, expected) => {
      expect(codeOf(() => requireAdminDismissal(requestIn(status), FAMILY_ID))).toBe(expected);
    },
  );

  it("answers another family's request as not found, whatever its state", () => {
    expect(codeOf(() => requireAdminDismissal(undefined, FAMILY_ID))).toBe('not_found');
    expect(codeOf(() => requireAdminDismissal(requestIn('approved'), OTHER_FAMILY_ID))).toBe(
      'not_found',
    );
  });
});

describe('toApplicantRequest', () => {
  const record: ApplicantRequestRecord = {
    id: REQUEST_ID,
    familyName: '外婆家',
    familyTimezone: 'Asia/Shanghai',
    adminName: '周秀英',
    status: 'pending',
    createdAt: CREATED_AT,
  };

  it('gives the time as an ISO date-time', () => {
    expect(toApplicantRequest(record)).toEqual({
      ...record,
      createdAt: '2026-11-21T09:12:00.000Z',
    });
  });

  it.each<JoinRequestStatus>(['pending', 'approved', 'rejected', 'expired'])(
    'shows a %s request',
    (status) => {
      expect(toApplicantRequest({ ...record, status }).status).toBe(status);
    },
  );

  it('refuses a withdrawn request', () => {
    expect(() => toApplicantRequest({ ...record, status: 'withdrawn' })).toThrow();
  });
});

/** The applicant's request as the admin's queries read it, in the given state. */
function familyRecord(status: JoinRequestStatus): FamilyRequestRecord {
  return {
    id: REQUEST_ID,
    parentId: APPLICANT,
    name: '陈晓',
    email: null,
    status,
    createdAt: CREATED_AT,
    closedAt: status === 'pending' ? null : CLOSED_AT,
  };
}

describe('toPendingRequest', () => {
  it("gives the applicant's parent id, name and email and the time as an ISO date-time", () => {
    expect(toPendingRequest(familyRecord('pending'))).toEqual({
      id: REQUEST_ID,
      parentId: APPLICANT,
      name: '陈晓',
      email: null,
      createdAt: '2026-11-21T09:12:00.000Z',
    });
  });
});

describe('toHandledRequest', () => {
  it("gives the applicant's parent id and the closing time as an ISO date-time", () => {
    expect(toHandledRequest(familyRecord('approved'))).toEqual({
      id: REQUEST_ID,
      parentId: APPLICANT,
      name: '陈晓',
      email: null,
      status: 'approved',
      closedAt: '2026-11-21T10:03:00.000Z',
    });
  });

  it.each<JoinRequestStatus>(['pending', 'withdrawn'])('refuses a %s request', (status) => {
    expect(() => toHandledRequest({ ...familyRecord(status), closedAt: CLOSED_AT })).toThrow();
  });

  it('refuses a request without a closing time', () => {
    expect(() => toHandledRequest({ ...familyRecord('approved'), closedAt: null })).toThrow();
  });
});

/**
 * A repository double over one family and its requests held in memory. A
 * transaction runs its work on the same store; `calls` lists the locks and
 * the writes in order.
 */
function createService(
  options: { roles?: Record<string, FamilyRole>; request?: RequestState } = {},
) {
  const roles = new Map(Object.entries(options.roles ?? { [ADMIN]: 'admin' }));
  const requests = new Map<string, RequestState>(
    options.request === undefined ? [] : [[REQUEST_ID, options.request]],
  );
  const calls: string[] = [];
  const familyRequest = (requestId: string): FamilyRequestRecord | undefined => {
    const request = requests.get(requestId);
    return (
      request && { ...familyRecord(request.status), id: requestId, parentId: request.parentId }
    );
  };
  const familyRequestsWhere = (keep: (status: JoinRequestStatus) => boolean) =>
    Promise.resolve(
      [...requests.keys()]
        .map(familyRequest)
        .filter((record): record is FamilyRequestRecord => record !== undefined)
        .filter((record) => keep(record.status)),
    );
  const store = {
    lockFamily: vi.fn((familyId: string) => {
      calls.push(`lockFamily ${familyId}`);
      return Promise.resolve();
    }),
    lockFamilyByCode: vi.fn((code: string) => {
      calls.push(`lockFamilyByCode ${code}`);
      return Promise.resolve(code === CODE ? FAMILY_ID : undefined);
    }),
    findFamilyByCode: vi.fn((code: string) =>
      Promise.resolve(
        code === CODE
          ? { id: FAMILY_ID, name: '外婆家', adminName: '周秀英', adminId: ADMIN }
          : undefined,
      ),
    ),
    memberRole: vi.fn((_familyId: string, parentId: string) =>
      Promise.resolve(roles.get(parentId)),
    ),
    hasPendingRequest: vi.fn((_familyId: string, parentId: string) =>
      Promise.resolve(
        [...requests.values()].some(
          (request) => request.parentId === parentId && request.status === 'pending',
        ),
      ),
    ),
    insertRequest: vi.fn((request: { familyId: string; parentId: string; code: string }) => {
      calls.push(`insertRequest ${request.parentId} ${request.code}`);
      requests.set(REQUEST_ID, { ...request, status: 'pending' });
      return Promise.resolve(REQUEST_ID);
    }),
    findRequest: vi.fn((requestId: string) => Promise.resolve(requests.get(requestId))),
    closeRequest: vi.fn((requestId: string, closing: Closing) => {
      calls.push(`closeRequest ${closing.status} by ${closing.closedBy ?? 'nobody'}`);
      const request = requests.get(requestId);
      if (request !== undefined) {
        requests.set(requestId, { ...request, status: closing.status });
      }
      return Promise.resolve();
    }),
    insertMember: vi.fn((_familyId: string, parentId: string, role: FamilyRole) => {
      calls.push(`insertMember ${parentId} ${role}`);
      roles.set(parentId, role);
      return Promise.resolve();
    }),
    dismissRequest: vi.fn((_requestId: string, side: string) => {
      calls.push(`dismissRequest ${side}`);
      return Promise.resolve();
    }),
    findApplicantRequest: vi.fn((requestId: string) => {
      const request = requests.get(requestId);
      return Promise.resolve(
        request && {
          id: requestId,
          familyName: '外婆家',
          familyTimezone: 'Asia/Shanghai',
          adminName: '周秀英',
          status: request.status,
          createdAt: CREATED_AT,
        },
      );
    }),
    findFamilyRequest: vi.fn((requestId: string) => Promise.resolve(familyRequest(requestId))),
    listPendingRequests: vi.fn(() => familyRequestsWhere((status) => status === 'pending')),
    listHandledRequests: vi.fn(() =>
      familyRequestsWhere((status) => status !== 'pending' && status !== 'withdrawn'),
    ),
  };
  const repository = {
    ...store,
    transaction: vi.fn(<T>(work: (transactionStore: typeof store) => Promise<T>) => work(store)),
  };
  return {
    service: new JoinRequestsService(repository as unknown as JoinRequestsRepository),
    store,
    roles,
    requests,
    calls,
  };
}

describe('JoinRequestsService', () => {
  describe('lookUp', () => {
    it("names the family and its admin, with the admin's parent id, for a parent who may apply", async () => {
      const { service } = createService();

      await expect(service.lookUp(APPLICANT, CODE)).resolves.toEqual({
        familyName: '外婆家',
        adminName: '周秀英',
        adminId: ADMIN,
      });
    });

    it.each<[string, Parameters<typeof createService>[0], string, ErrorCode]>([
      ['an unknown code', {}, '222222', 'code_not_found'],
      ['a member', { roles: { [ADMIN]: 'admin', [APPLICANT]: 'member' } }, CODE, 'already_member'],
      [
        'a parent with a pending request',
        { request: requestIn('pending') },
        CODE,
        'request_pending',
      ],
    ])('refuses %s', async (_case, options, code, expected) => {
      const { service } = createService(options);

      expect(await rejectionCode(service.lookUp(APPLICANT, code))).toBe(expected);
    });

    it('lets a parent whose earlier request was rejected apply again', async () => {
      const { service } = createService({ request: requestIn('rejected') });

      await expect(service.lookUp(APPLICANT, CODE)).resolves.toMatchObject({
        familyName: '外婆家',
      });
    });
  });

  describe('apply', () => {
    it('locks the family by its code, then records a pending request with the code', async () => {
      const { service, calls } = createService();

      const request = await service.apply(APPLICANT, CODE);

      expect(request).toEqual({
        id: REQUEST_ID,
        familyName: '外婆家',
        familyTimezone: 'Asia/Shanghai',
        adminName: '周秀英',
        status: 'pending',
        createdAt: CREATED_AT.toISOString(),
      });
      expect(calls).toEqual([`lockFamilyByCode ${CODE}`, `insertRequest ${APPLICANT} ${CODE}`]);
    });

    it.each<[string, Parameters<typeof createService>[0], string, ErrorCode]>([
      ['a code no family has, or had a moment ago', {}, '222222', 'code_not_found'],
      ['a member', { roles: { [ADMIN]: 'admin', [APPLICANT]: 'member' } }, CODE, 'already_member'],
      ['a second pending request', { request: requestIn('pending') }, CODE, 'request_pending'],
    ])('refuses %s without recording anything', async (_case, options, code, expected) => {
      const { service, store } = createService(options);

      expect(await rejectionCode(service.apply(APPLICANT, code))).toBe(expected);
      expect(store.insertRequest).not.toHaveBeenCalled();
    });

    it('answers a request that lost the race to the unique index as already pending', async () => {
      const { service, store } = createService();
      store.insertRequest.mockRejectedValueOnce(new RequestPendingError());

      expect(await rejectionCode(service.apply(APPLICANT, CODE))).toBe('request_pending');
    });

    it('lets any other error through', async () => {
      const { service, store } = createService();
      const failure = new Error('connection lost');
      store.insertRequest.mockRejectedValueOnce(failure);

      await expect(service.apply(APPLICANT, CODE)).rejects.toBe(failure);
    });
  });

  describe('withdraw', () => {
    it("locks the request's family, then closes the request as withdrawn by nobody", async () => {
      const { service, calls, requests } = createService({ request: requestIn('pending') });

      await service.withdraw(APPLICANT, REQUEST_ID);

      expect(calls).toEqual([`lockFamily ${FAMILY_ID}`, 'closeRequest withdrawn by nobody']);
      expect(requests.get(REQUEST_ID)?.status).toBe('withdrawn');
    });

    it('checks the request as it stands under the lock', async () => {
      const { service, store } = createService({ request: requestIn('pending') });
      store.findRequest.mockResolvedValueOnce(requestIn('pending'));
      store.findRequest.mockResolvedValueOnce(requestIn('approved'));

      expect(await rejectionCode(service.withdraw(APPLICANT, REQUEST_ID))).toBe('request_closed');
      expect(store.closeRequest).not.toHaveBeenCalled();
    });

    it('answers a request that does not exist as not found without locking anything', async () => {
      const { service, calls } = createService();

      expect(await rejectionCode(service.withdraw(APPLICANT, REQUEST_ID))).toBe('not_found');
      expect(calls).toEqual([]);
    });
  });

  describe('dismissOwn', () => {
    it.each<JoinRequestStatus>(['approved', 'rejected', 'expired'])(
      "records the applicant's 「知道了」 on a %s request under the family's lock",
      async (status) => {
        const { service, calls } = createService({ request: requestIn(status) });

        await service.dismissOwn(APPLICANT, REQUEST_ID);

        expect(calls).toEqual([`lockFamily ${FAMILY_ID}`, 'dismissRequest applicant']);
      },
    );

    it('checks the request as it stands under the lock', async () => {
      const { service, store } = createService({ request: requestIn('approved') });
      store.findRequest.mockResolvedValueOnce(requestIn('approved'));
      store.findRequest.mockResolvedValueOnce(requestIn('withdrawn'));

      expect(await rejectionCode(service.dismissOwn(APPLICANT, REQUEST_ID))).toBe('not_found');
      expect(store.dismissRequest).not.toHaveBeenCalled();
    });

    it("refuses someone else's request without writing", async () => {
      const { service, store } = createService({ request: requestIn('rejected') });

      expect(await rejectionCode(service.dismissOwn(STRANGER, REQUEST_ID))).toBe('not_found');
      expect(store.dismissRequest).not.toHaveBeenCalled();
    });
  });

  describe('listFamily', () => {
    it("lists the pending and the handled requests with each applicant's parent id", async () => {
      const { service } = createService({ request: requestIn('pending') });

      await expect(service.listFamily(FAMILY_ID)).resolves.toEqual({
        pending: [expect.objectContaining({ id: REQUEST_ID, parentId: APPLICANT })],
        handled: [],
      });
    });

    it('puts an expired request among the handled ones', async () => {
      const { service } = createService({ request: requestIn('expired') });

      const listed = await service.listFamily(FAMILY_ID);

      expect(listed.pending).toEqual([]);
      expect(listed.handled).toEqual([
        expect.objectContaining({ parentId: APPLICANT, status: 'expired' }),
      ]);
    });
  });

  describe('decide', () => {
    it('approves: closes the request by the admin and makes the applicant a member, under the lock', async () => {
      const { service, calls, roles } = createService({ request: requestIn('pending') });

      const handled = await service.decide(ADMIN, FAMILY_ID, REQUEST_ID, 'approved');

      expect(handled).toMatchObject({ id: REQUEST_ID, parentId: APPLICANT, status: 'approved' });
      expect(calls).toEqual([
        `lockFamily ${FAMILY_ID}`,
        `closeRequest approved by ${ADMIN}`,
        `insertMember ${APPLICANT} member`,
      ]);
      expect(roles.get(APPLICANT)).toBe('member');
    });

    it('rejects: closes the request by the admin and adds nobody', async () => {
      const { service, calls, roles } = createService({ request: requestIn('pending') });

      const handled = await service.decide(ADMIN, FAMILY_ID, REQUEST_ID, 'rejected');

      expect(handled).toMatchObject({ id: REQUEST_ID, parentId: APPLICANT, status: 'rejected' });
      expect(calls).toEqual([`lockFamily ${FAMILY_ID}`, `closeRequest rejected by ${ADMIN}`]);
      expect(roles.has(APPLICANT)).toBe(false);
    });

    it.each<[string, Record<string, FamilyRole>, ErrorCode]>([
      ['an admin who handed the role over', { [ADMIN]: 'member' }, 'not_admin'],
      ['an admin who was taken out', {}, 'family_not_found'],
    ])('refuses %s, checked under the lock', async (_who, roles, expected) => {
      const { service, store } = createService({ roles, request: requestIn('pending') });

      expect(await rejectionCode(service.decide(ADMIN, FAMILY_ID, REQUEST_ID, 'approved'))).toBe(
        expected,
      );
      expect(store.lockFamily).toHaveBeenCalledWith(FAMILY_ID);
      expect(store.closeRequest).not.toHaveBeenCalled();
      expect(store.insertMember).not.toHaveBeenCalled();
    });

    it.each<JoinRequestStatus>(['approved', 'rejected', 'withdrawn', 'expired'])(
      'refuses a %s request with request_closed and writes nothing',
      async (status) => {
        const { service, store } = createService({ request: requestIn(status) });

        expect(await rejectionCode(service.decide(ADMIN, FAMILY_ID, REQUEST_ID, 'approved'))).toBe(
          'request_closed',
        );
        expect(store.closeRequest).not.toHaveBeenCalled();
        expect(store.insertMember).not.toHaveBeenCalled();
      },
    );

    it("refuses another family's request as not found", async () => {
      const { service, store } = createService({ request: requestIn('pending') });

      expect(
        await rejectionCode(service.decide(ADMIN, OTHER_FAMILY_ID, REQUEST_ID, 'approved')),
      ).toBe('not_found');
      expect(store.insertMember).not.toHaveBeenCalled();
    });
  });

  describe('dismissForFamily', () => {
    it("records the admin's 「知道了」 under the lock", async () => {
      const { service, calls } = createService({ request: requestIn('approved') });

      await service.dismissForFamily(ADMIN, FAMILY_ID, REQUEST_ID);

      expect(calls).toEqual([`lockFamily ${FAMILY_ID}`, 'dismissRequest admin']);
    });

    it('refuses a pending request without writing', async () => {
      const { service, store } = createService({ request: requestIn('pending') });

      expect(await rejectionCode(service.dismissForFamily(ADMIN, FAMILY_ID, REQUEST_ID))).toBe(
        'request_pending',
      );
      expect(store.dismissRequest).not.toHaveBeenCalled();
    });
  });
});
