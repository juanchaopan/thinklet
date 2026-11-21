import { familyCodeSchema, type ErrorCode, type FamilyRole } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import {
  FamilyCodeTakenError,
  type FamiliesRepository,
  type FamilyRecord,
  type MemberRecord,
  type NewFamily,
} from './families.repository.js';
import {
  FAMILY_CODE_ATTEMPTS,
  FamiliesService,
  requireAccess,
  requireRemoval,
  toFamilyDetail,
  type FamilyAccess,
  type Removal,
} from './families.service.js';

const FAMILY_ID = 'family-1';
const ADMIN = 'parent-admin';
const MEMBER = 'parent-member';
const STRANGER = 'parent-stranger';

/** A family of an admin and one member. */
const ADMIN_AND_MEMBER: Record<string, FamilyRole> = { [ADMIN]: 'admin', [MEMBER]: 'member' };

const NEW_FAMILY = { name: '林悦的家', timezone: 'Asia/Shanghai' };

const family: FamilyRecord = { id: FAMILY_ID, ...NEW_FAMILY, code: '7KQ4MZ' };

/** The error a call throws, or undefined when it returns. */
function errorOf(call: () => unknown): ApiError | undefined {
  try {
    call();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  return undefined;
}

/** The error code a promise rejects with; fails when it resolves. */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
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

/**
 * A repository double over one family's members held in memory. A
 * transaction runs its work on the same store; `calls` lists the lock and
 * the writes in order. Like the database's index, setting a second admin
 * fails.
 */
function createService(initialRoles: Record<string, FamilyRole> = {}) {
  const roles = new Map(Object.entries(initialRoles));
  const calls: string[] = [];
  const record = (call: string) => {
    calls.push(call);
    return Promise.resolve();
  };
  const store = {
    lockFamily: vi.fn(() => record('lockFamily')),
    memberRole: vi.fn((_familyId: string, parentId: string) =>
      Promise.resolve(roles.get(parentId)),
    ),
    findFamily: vi.fn(() => Promise.resolve(roles.size > 0 ? family : undefined)),
    listMembers: vi.fn(() =>
      Promise.resolve(
        [...roles].map(([parentId, role]): MemberRecord => ({
          parentId,
          name: parentId,
          email: null,
          role,
        })),
      ),
    ),
    insertFamily: vi.fn<(newFamily: NewFamily) => Promise<string>>(() =>
      Promise.resolve(FAMILY_ID),
    ),
    insertMember: vi.fn((_familyId: string, parentId: string, role: FamilyRole) => {
      roles.set(parentId, role);
      return Promise.resolve();
    }),
    updateFamily: vi.fn(() => record('updateFamily')),
    updateCode: vi.fn<(familyId: string, code: string) => Promise<void>>(() =>
      record('updateCode'),
    ),
    expirePendingRequests: vi.fn(() => record('expirePendingRequests')),
    setRole: vi.fn((_familyId: string, parentId: string, role: FamilyRole) => {
      const otherAdmin = [...roles].some(([id, held]) => id !== parentId && held === 'admin');
      if (role === 'admin' && otherAdmin) {
        return Promise.reject(new Error('A second admin'));
      }
      roles.set(parentId, role);
      return record(`setRole ${parentId} ${role}`);
    }),
    deleteMember: vi.fn((_familyId: string, parentId: string) => {
      roles.delete(parentId);
      return record(`deleteMember ${parentId}`);
    }),
  };
  const repository = {
    ...store,
    transaction: vi.fn(<T>(work: (transactionStore: typeof store) => Promise<T>) => work(store)),
  };
  return {
    service: new FamiliesService(repository as unknown as FamiliesRepository),
    store,
    repository,
    roles,
    calls,
  };
}

describe('requireAccess', () => {
  it.each<[string, FamilyRole | undefined, FamilyAccess, { code: ErrorCode; status: number }]>([
    ['a non-member', undefined, 'member', { code: 'family_not_found', status: 404 }],
    ['a non-member', undefined, 'admin', { code: 'family_not_found', status: 404 }],
    ['a member', 'member', 'admin', { code: 'not_admin', status: 403 }],
  ])('refuses %s on a route for the %s', (_who, role, access, expected) => {
    const error = errorOf(() => requireAccess(role, access));

    expect({ code: error?.code, status: error?.getStatus() }).toEqual(expected);
  });

  it.each<[string, FamilyRole, FamilyAccess]>([
    ['a member', 'member', 'member'],
    ['the admin', 'admin', 'member'],
    ['the admin', 'admin', 'admin'],
  ])('lets %s use a route for the %s', (_who, role, access) => {
    expect(requireAccess(role, access)).toBe(role);
  });
});

describe('requireRemoval', () => {
  it.each<[string, Removal, ErrorCode | undefined]>([
    ['a member leaving', { by: 'member', of: 'member', self: true }, undefined],
    ['the admin leaving', { by: 'admin', of: 'admin', self: true }, 'admin_cannot_leave'],
    ['a non-member leaving', { by: undefined, of: undefined, self: true }, 'family_not_found'],
    ['the admin taking out a member', { by: 'admin', of: 'member', self: false }, undefined],
    [
      'the admin taking out a parent no longer there',
      { by: 'admin', of: undefined, self: false },
      'not_a_member',
    ],
    ['a member taking out another', { by: 'member', of: 'member', self: false }, 'not_admin'],
    ['a member taking out the admin', { by: 'member', of: 'admin', self: false }, 'not_admin'],
    [
      'a member taking out a parent no longer there',
      { by: 'member', of: undefined, self: false },
      'not_admin',
    ],
    [
      'a non-member taking out a member',
      { by: undefined, of: 'member', self: false },
      'family_not_found',
    ],
    [
      'anyone taking out the admin',
      { by: 'admin', of: 'admin', self: false },
      'admin_cannot_leave',
    ],
  ])('answers %s with %s', (_case, removal, code) => {
    expect(errorOf(() => requireRemoval(removal))?.code).toBe(code);
  });
});

describe('toFamilyDetail', () => {
  const members: MemberRecord[] = [
    { parentId: ADMIN, name: '林悦', email: 'linyue@example.com', role: 'admin' },
    { parentId: MEMBER, name: '周子航', email: null, role: 'member' },
  ];

  it("gives the parent's own role and marks them among the members, keeping the order", () => {
    expect(toFamilyDetail(family, members, MEMBER)).toEqual({
      ...family,
      role: 'member',
      members: [
        { parentId: ADMIN, name: '林悦', email: 'linyue@example.com', role: 'admin', you: false },
        { parentId: MEMBER, name: '周子航', email: null, role: 'member', you: true },
      ],
    });
  });

  it('answers a parent who is not a member, or a missing family, as not found', () => {
    expect(errorOf(() => toFamilyDetail(family, members, STRANGER))?.code).toBe('family_not_found');
    expect(errorOf(() => toFamilyDetail(undefined, [], ADMIN))?.code).toBe('family_not_found');
  });
});

describe('FamiliesService', () => {
  describe('checkAccess', () => {
    it('reads the role from the database on every check', async () => {
      const { service, repository } = createService(ADMIN_AND_MEMBER);

      await expect(service.checkAccess(ADMIN, FAMILY_ID, 'admin')).resolves.toBeUndefined();
      await expect(service.checkAccess(MEMBER, FAMILY_ID, 'member')).resolves.toBeUndefined();
      expect(await rejectionCode(service.checkAccess(MEMBER, FAMILY_ID, 'admin'))).toBe(
        'not_admin',
      );
      expect(await rejectionCode(service.checkAccess(STRANGER, FAMILY_ID, 'member'))).toBe(
        'family_not_found',
      );
      expect(repository.memberRole).toHaveBeenCalledTimes(4);
    });
  });

  describe('create', () => {
    it('makes the creator the admin and gives the family a valid code', async () => {
      const { service, store } = createService();

      const detail = await service.create(ADMIN, NEW_FAMILY);

      const code = store.insertFamily.mock.calls[0]?.[0].code;
      expect(familyCodeSchema.safeParse(code).success).toBe(true);
      expect(store.insertFamily).toHaveBeenCalledWith({ ...NEW_FAMILY, code });
      expect(store.insertMember).toHaveBeenCalledWith(FAMILY_ID, ADMIN, 'admin');
      expect(detail).toMatchObject({ role: 'admin', members: [{ parentId: ADMIN, you: true }] });
    });

    it('draws a new code in a new transaction each time the code is taken', async () => {
      const { service, store, repository } = createService();
      for (let taken = 1; taken < FAMILY_CODE_ATTEMPTS; taken += 1) {
        store.insertFamily.mockRejectedValueOnce(new FamilyCodeTakenError());
      }

      await expect(service.create(ADMIN, NEW_FAMILY)).resolves.toMatchObject({ role: 'admin' });

      expect(store.insertFamily).toHaveBeenCalledTimes(FAMILY_CODE_ATTEMPTS);
      expect(repository.transaction).toHaveBeenCalledTimes(FAMILY_CODE_ATTEMPTS);
      for (const [newFamily] of store.insertFamily.mock.calls) {
        expect(familyCodeSchema.safeParse(newFamily.code).success).toBe(true);
      }
    });

    it('gives up after five taken codes', async () => {
      const { service, store } = createService();
      store.insertFamily.mockRejectedValue(new FamilyCodeTakenError());

      await expect(service.create(ADMIN, NEW_FAMILY)).rejects.toThrow(
        'No free family code in 5 attempts',
      );

      expect(FAMILY_CODE_ATTEMPTS).toBe(5);
      expect(store.insertFamily).toHaveBeenCalledTimes(5);
      expect(store.insertMember).not.toHaveBeenCalled();
    });

    it('does not retry other failures', async () => {
      const { service, store } = createService();
      store.insertFamily.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(ADMIN, NEW_FAMILY)).rejects.toThrow('connection lost');
      expect(store.insertFamily).toHaveBeenCalledTimes(1);
    });
  });

  describe('get', () => {
    it('shows the family to its members only', async () => {
      const { service } = createService(ADMIN_AND_MEMBER);

      await expect(service.get(MEMBER, FAMILY_ID)).resolves.toMatchObject({ role: 'member' });
      expect(await rejectionCode(service.get(STRANGER, FAMILY_ID))).toBe('family_not_found');
    });
  });

  describe('update', () => {
    it('lets the admin change the settings under the lock of the family', async () => {
      const { service, store, calls } = createService(ADMIN_AND_MEMBER);

      await service.update(ADMIN, FAMILY_ID, { name: '外婆家' });

      expect(store.updateFamily).toHaveBeenCalledWith(FAMILY_ID, { name: '外婆家' });
      expect(calls).toEqual(['lockFamily', 'updateFamily']);
    });

    it('writes nothing for an empty change', async () => {
      const { service, store } = createService(ADMIN_AND_MEMBER);

      await expect(service.update(ADMIN, FAMILY_ID, {})).resolves.toMatchObject({
        name: '林悦的家',
      });
      expect(store.updateFamily).not.toHaveBeenCalled();
    });

    it.each([
      [MEMBER, 'not_admin'],
      [STRANGER, 'family_not_found'],
    ])('refuses %s with %s', async (parentId, code) => {
      const { service, store } = createService(ADMIN_AND_MEMBER);

      expect(
        await rejectionCode(service.update(parentId, FAMILY_ID, { timezone: 'Europe/London' })),
      ).toBe(code);
      expect(store.updateFamily).not.toHaveBeenCalled();
    });
  });

  describe('changeCode', () => {
    it('sets a valid new code and expires the pending requests in the same transaction', async () => {
      const { service, store, repository, calls } = createService(ADMIN_AND_MEMBER);

      await service.changeCode(ADMIN, FAMILY_ID);

      expect(familyCodeSchema.safeParse(store.updateCode.mock.calls[0]?.[1]).success).toBe(true);
      expect(store.expirePendingRequests).toHaveBeenCalledWith(FAMILY_ID, expect.any(Date));
      expect(calls).toEqual(['lockFamily', 'updateCode', 'expirePendingRequests']);
      expect(repository.transaction).toHaveBeenCalledTimes(1);
    });

    it('draws again when the code is taken', async () => {
      const { service, store, repository } = createService(ADMIN_AND_MEMBER);
      store.updateCode.mockRejectedValueOnce(new FamilyCodeTakenError());

      await service.changeCode(ADMIN, FAMILY_ID);

      expect(store.updateCode).toHaveBeenCalledTimes(2);
      expect(repository.transaction).toHaveBeenCalledTimes(2);
      expect(store.expirePendingRequests).toHaveBeenCalledTimes(1);
    });

    it('gives up after five taken codes', async () => {
      const { service, store } = createService(ADMIN_AND_MEMBER);
      store.updateCode.mockRejectedValue(new FamilyCodeTakenError());

      await expect(service.changeCode(ADMIN, FAMILY_ID)).rejects.toThrow(
        'No free family code in 5 attempts',
      );
      expect(store.updateCode).toHaveBeenCalledTimes(5);
      expect(store.expirePendingRequests).not.toHaveBeenCalled();
    });

    it.each([
      [MEMBER, 'not_admin'],
      [STRANGER, 'family_not_found'],
    ])('refuses %s with %s and expires nothing', async (parentId, code) => {
      const { service, store } = createService(ADMIN_AND_MEMBER);

      expect(await rejectionCode(service.changeCode(parentId, FAMILY_ID))).toBe(code);
      expect(store.updateCode).not.toHaveBeenCalled();
      expect(store.expirePendingRequests).not.toHaveBeenCalled();
    });
  });

  describe('transferAdmin', () => {
    it('demotes the admin before promoting the new one', async () => {
      const { service, calls, roles } = createService(ADMIN_AND_MEMBER);

      const detail = await service.transferAdmin(ADMIN, FAMILY_ID, MEMBER);

      expect(calls).toEqual(['lockFamily', `setRole ${ADMIN} member`, `setRole ${MEMBER} admin`]);
      expect(Object.fromEntries(roles)).toEqual({ [ADMIN]: 'member', [MEMBER]: 'admin' });
      expect(detail.role).toBe('member');
    });

    it('refuses a new admin who is not a member', async () => {
      const { service, store } = createService(ADMIN_AND_MEMBER);

      expect(await rejectionCode(service.transferAdmin(ADMIN, FAMILY_ID, STRANGER))).toBe(
        'not_a_member',
      );
      expect(store.setRole).not.toHaveBeenCalled();
    });

    it.each([
      [MEMBER, ADMIN, 'not_admin'],
      [STRANGER, MEMBER, 'family_not_found'],
    ])('refuses %s with %s', async (parentId, newAdminId, code) => {
      const { service, store } = createService(ADMIN_AND_MEMBER);

      expect(await rejectionCode(service.transferAdmin(parentId, FAMILY_ID, newAdminId))).toBe(
        code,
      );
      expect(store.setRole).not.toHaveBeenCalled();
    });

    it('refuses a parent who has just handed over the admin role', async () => {
      const { service } = createService({ ...ADMIN_AND_MEMBER, 'parent-third': 'member' });

      await service.transferAdmin(ADMIN, FAMILY_ID, MEMBER);

      expect(await rejectionCode(service.transferAdmin(ADMIN, FAMILY_ID, 'parent-third'))).toBe(
        'not_admin',
      );
    });
  });

  describe('removeMember', () => {
    it('lets a member leave under the lock of the family', async () => {
      const { service, calls } = createService(ADMIN_AND_MEMBER);

      await service.removeMember(MEMBER, FAMILY_ID, MEMBER);

      expect(calls).toEqual(['lockFamily', `deleteMember ${MEMBER}`]);
    });

    it('lets the admin take out a member under the lock of the family', async () => {
      const { service, calls } = createService(ADMIN_AND_MEMBER);

      await service.removeMember(ADMIN, FAMILY_ID, MEMBER);

      expect(calls).toEqual(['lockFamily', `deleteMember ${MEMBER}`]);
    });

    it.each([
      ['the admin leaving', ADMIN, ADMIN, 'admin_cannot_leave'],
      ['a member taking out the admin', MEMBER, ADMIN, 'not_admin'],
      ['the admin taking out a non-member', ADMIN, STRANGER, 'not_a_member'],
      ['a non-member taking out a member', STRANGER, MEMBER, 'family_not_found'],
      ['a non-member leaving', STRANGER, STRANGER, 'family_not_found'],
    ])('refuses %s', async (_case, parentId, memberId, code) => {
      const { service, store } = createService(ADMIN_AND_MEMBER);

      expect(await rejectionCode(service.removeMember(parentId, FAMILY_ID, memberId))).toBe(code);
      expect(store.deleteMember).not.toHaveBeenCalled();
    });

    it('refuses taking out a parent who is already gone', async () => {
      const { service } = createService(ADMIN_AND_MEMBER);
      await service.removeMember(ADMIN, FAMILY_ID, MEMBER);

      expect(await rejectionCode(service.removeMember(ADMIN, FAMILY_ID, MEMBER))).toBe(
        'not_a_member',
      );
    });
  });
});
