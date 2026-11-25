import type { ConfigService } from '@nestjs/config';
import type { ErrorCode } from '@thinklet/contracts';
import type { Environment } from '../../infrastructure/config/environment.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { AuditEvent, AuditService } from '../audit/audit.service.js';
import {
  AccountTakenError,
  type ChildChanges,
  type ChildRecord,
  type ChildrenRepository,
  type DeviceRecord,
  type NewChild,
} from './children.repository.js';
import {
  CHILD_CONSENT_VERSION,
  changedChildFields,
  ChildrenService,
  loginLinkStatus,
  toDevice,
} from './children.service.js';
import {
  LOGIN_LINK_LIFETIME_MS,
  type LoginLinks,
  type LoginLinkState,
  type NewLoginLink,
} from './login-links.js';
import { hashToken } from './tokens.js';

const APP_ORIGIN = 'https://thinklet.example';
const FAMILY_ID = 'family-1';
const PARENT_ID = 'parent-1';
const CHILD_ID = 'child-1';
const LINK_ID = 'link-1';
const DEVICE_ID = 'device-1';
const NOW = new Date('2026-11-22T09:00:00.000Z');
const XIAOMI: ChildRecord = { id: CHILD_ID, nickname: '小米', account: 'xiaomi' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The transaction the repository double hands its work, which the audit events are written with. */
const TRANSACTION = { transaction: 'children' };

/** Who acted on which child of which family, as every audit event of the service names them. */
const ON_XIAOMI = {
  actor: { kind: 'parent', id: PARENT_ID },
  targetId: CHILD_ID,
  familyId: FAMILY_ID,
} as const;

/** The stored state of one of Xiaomi's links, active unless the changes say otherwise. */
const stateOf = (changes: Partial<LoginLinkState> = {}): LoginLinkState => ({
  childId: CHILD_ID,
  status: 'active',
  expiresAt: '2026-11-22T09:04:00.000Z',
  ...changes,
});

/**
 * The error code the call is refused with. A call that succeeds, or fails
 * with anything but an api error, fails the test.
 */
function refusalOf(call: Promise<unknown>): Promise<ErrorCode> {
  return call.then(
    () => {
      throw new Error('The call succeeded');
    },
    (error: unknown) => {
      if (error instanceof ApiError) {
        return error.code;
      }
      throw error;
    },
  );
}

describe('loginLinkStatus', () => {
  it.each<LoginLinkState['status']>(['active', 'used', 'revoked'])(
    'reads a stored %s state as it is, with its expiry time',
    (status) => {
      expect(loginLinkStatus(stateOf({ status }), NOW)).toEqual({
        status,
        expiresAt: '2026-11-22T09:04:00.000Z',
      });
    },
  );

  it('reads a state that is gone as expired by now', () => {
    expect(loginLinkStatus(undefined, NOW)).toEqual({
      status: 'expired',
      expiresAt: NOW.toISOString(),
    });
  });
});

describe('toDevice', () => {
  it('gives the times as ISO date-times', () => {
    const record: DeviceRecord = {
      id: DEVICE_ID,
      name: 'iPad · Safari',
      rememberedAt: new Date('2026-11-18T08:30:00Z'),
      lastUsedAt: new Date('2026-11-22T01:12:00Z'),
    };

    expect(toDevice(record)).toEqual({
      id: DEVICE_ID,
      name: 'iPad · Safari',
      rememberedAt: '2026-11-18T08:30:00.000Z',
      lastUsedAt: '2026-11-22T01:12:00.000Z',
    });
  });
});

describe('changedChildFields', () => {
  it('names the fields a change gives, in a fixed order', () => {
    expect(changedChildFields({ account: 'mimi', nickname: '米米' })).toEqual([
      'nickname',
      'account',
    ]);
    expect(changedChildFields({ account: 'mimi' })).toEqual(['account']);
    expect(changedChildFields({})).toEqual([]);
  });
});

/**
 * A repository double over one family with at most one child, held in
 * memory, the child remembered on one device unless told otherwise, and a
 * double of the login links in Redis that holds the given state of link
 * LINK_ID. A transaction runs its work on the same store; `calls` lists
 * the transactions, the locks, the writes, the audit events and the
 * commands to the links in order.
 */
function createService(
  options: { child?: boolean; devices?: boolean; state?: LoginLinkState } = {},
) {
  let exists = options.child ?? true;
  let remembered = options.devices ?? true;
  const calls: string[] = [];
  const inFamily = (familyId: string, childId: string) =>
    exists && familyId === FAMILY_ID && childId === CHILD_ID;
  const store = {
    childExists: vi.fn((familyId: string, childId: string) =>
      Promise.resolve(inFamily(familyId, childId)),
    ),
    lockChild: vi.fn((familyId: string, childId: string) => {
      calls.push(`lockChild ${childId}`);
      return Promise.resolve(inFamily(familyId, childId));
    }),
    listChildren: vi.fn(() => Promise.resolve(exists ? [XIAOMI] : [])),
    insertChild: vi.fn((child: NewChild) =>
      Promise.resolve({ id: CHILD_ID, nickname: child.nickname, account: child.account }),
    ),
    updateChild: vi.fn((familyId: string, childId: string, changes: ChildChanges) =>
      Promise.resolve(inFamily(familyId, childId) ? { ...XIAOMI, ...changes } : undefined),
    ),
    deleteChild: vi.fn((familyId: string, childId: string) => {
      calls.push(`deleteChild ${childId}`);
      const deleted = inFamily(familyId, childId);
      exists = exists && !deleted;
      return Promise.resolve(deleted);
    }),
    clearPassword: vi.fn((familyId: string, childId: string) => {
      calls.push(`clearPassword ${childId}`);
      return Promise.resolve(inFamily(familyId, childId));
    }),
    listDevices: vi.fn((): Promise<DeviceRecord[]> => Promise.resolve([])),
    deleteDevice: vi.fn((childId: string, deviceId: string) => {
      calls.push(`deleteDevice ${childId} ${deviceId}`);
      const deleted = remembered && deviceId === DEVICE_ID;
      remembered = remembered && !deleted;
      return Promise.resolve(deleted);
    }),
    deleteDevices: vi.fn((childId: string) => {
      calls.push(`deleteDevices ${childId}`);
      const deleted = remembered ? 1 : 0;
      remembered = false;
      return Promise.resolve(deleted);
    }),
  };
  const repository = {
    ...store,
    transaction: vi.fn(
      async <T>(work: (transactionStore: typeof store, transaction: unknown) => Promise<T>) => {
        calls.push('transaction');
        const result = await work(store, TRANSACTION);
        calls.push('commit');
        return result;
      },
    ),
  };
  const audit = {
    record: vi.fn((_transaction: unknown, event: AuditEvent) => {
      calls.push(`audit ${event.action}`);
      return Promise.resolve();
    }),
  };
  const links = {
    create: vi.fn((link: NewLoginLink) => {
      calls.push(`links.create ${link.childId}`);
      return Promise.resolve();
    }),
    state: vi.fn((linkId: string) =>
      Promise.resolve(linkId === LINK_ID ? options.state : undefined),
    ),
    removeOf: vi.fn((childIds: readonly string[]) => {
      calls.push(`links.removeOf ${childIds.join(' ')}`);
      return Promise.resolve();
    }),
  };
  const config = { get: () => APP_ORIGIN } as unknown as ConfigService<Environment, true>;
  return {
    service: new ChildrenService(
      repository as unknown as ChildrenRepository,
      audit as unknown as AuditService,
      links as unknown as LoginLinks,
      config,
    ),
    store,
    audit,
    links,
    calls,
  };
}

describe('ChildrenService', () => {
  const newChild = { nickname: '小米', account: 'xiaomi', consent: true } as const;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the children of the family', async () => {
    const { service, store } = createService();

    await expect(service.list(FAMILY_ID)).resolves.toEqual([XIAOMI]);
    expect(store.listChildren).toHaveBeenCalledWith(FAMILY_ID);
  });

  describe('add', () => {
    it("adds the child and records the adding parent's consent with its version", async () => {
      const { service, store, audit, calls } = createService({ child: false });

      const child = await service.add(PARENT_ID, FAMILY_ID, newChild);

      expect(child).toEqual(XIAOMI);
      expect(store.insertChild).toHaveBeenCalledWith({
        familyId: FAMILY_ID,
        nickname: '小米',
        account: 'xiaomi',
      });
      expect(calls).toEqual(['transaction', 'audit child.created', 'commit']);
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_XIAOMI,
        action: 'child.created',
        details: { consentVersion: '2026-11-22' },
      });
      expect(CHILD_CONSENT_VERSION).toBe('2026-11-22');
    });

    it('answers an account another child of the family has with account_taken', async () => {
      const { service, store, audit } = createService();
      store.insertChild.mockRejectedValueOnce(new AccountTakenError());

      expect(await refusalOf(service.add(PARENT_ID, FAMILY_ID, newChild))).toBe('account_taken');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('passes any other failure on as it is', async () => {
      const { service, store } = createService();
      const failure = new Error('connection lost');
      store.insertChild.mockRejectedValueOnce(failure);

      await expect(service.add(PARENT_ID, FAMILY_ID, newChild)).rejects.toBe(failure);
    });
  });

  describe('update', () => {
    it('returns the child with the changes and records the fields changed', async () => {
      const { service, audit } = createService();

      await expect(
        service.update(PARENT_ID, FAMILY_ID, CHILD_ID, { nickname: '米米' }),
      ).resolves.toEqual({ ...XIAOMI, nickname: '米米' });
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_XIAOMI,
        action: 'child.updated',
        details: { fields: ['nickname'] },
      });
    });

    it('records nothing for a change of neither field', async () => {
      const { service, audit } = createService();

      await expect(service.update(PARENT_ID, FAMILY_ID, CHILD_ID, {})).resolves.toEqual(XIAOMI);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers a child the family does not have with child_not_found', async () => {
      const { service, audit } = createService();

      expect(
        await refusalOf(service.update(PARENT_ID, 'family-2', CHILD_ID, { nickname: '米米' })),
      ).toBe('child_not_found');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers an account another child of the family has with account_taken', async () => {
      const { service, store, audit } = createService();
      store.updateChild.mockRejectedValueOnce(new AccountTakenError());

      expect(
        await refusalOf(service.update(PARENT_ID, FAMILY_ID, CHILD_ID, { account: 'dami' })),
      ).toBe('account_taken');
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the child and records it, then removes its login link once committed', async () => {
      const { service, audit, calls } = createService();

      await expect(service.remove(PARENT_ID, FAMILY_ID, CHILD_ID)).resolves.toBeUndefined();

      expect(calls).toEqual([
        'transaction',
        `deleteChild ${CHILD_ID}`,
        'audit child.deleted',
        'commit',
        `links.removeOf ${CHILD_ID}`,
      ]);
      expect(audit.record).toHaveBeenCalledExactlyOnceWith(TRANSACTION, {
        ...ON_XIAOMI,
        action: 'child.deleted',
      });
    });

    it('answers a child that is gone with child_not_found and removes no link', async () => {
      const { service, audit, links } = createService({ child: false });

      expect(await refusalOf(service.remove(PARENT_ID, FAMILY_ID, CHILD_ID))).toBe(
        'child_not_found',
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(links.removeOf).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('locks the child, then clears the password, forgets every device and records it, in one transaction', async () => {
      const { service, audit, links, calls } = createService();

      await service.resetPassword(PARENT_ID, FAMILY_ID, CHILD_ID);

      expect(calls).toEqual([
        'transaction',
        `lockChild ${CHILD_ID}`,
        `clearPassword ${CHILD_ID}`,
        `deleteDevices ${CHILD_ID}`,
        'audit child.password_reset',
        'commit',
      ]);
      expect(links.create).not.toHaveBeenCalled();
      expect(links.removeOf).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_XIAOMI,
        action: 'child.password_reset',
      });
    });

    it('answers a child of another family with child_not_found and changes nothing', async () => {
      const { service, store, audit } = createService();

      expect(await refusalOf(service.resetPassword(PARENT_ID, 'family-2', CHILD_ID))).toBe(
        'child_not_found',
      );
      expect(store.clearPassword).not.toHaveBeenCalled();
      expect(store.deleteDevices).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('createLoginLink', () => {
    it('locks the child and records the audit event, then stores the link last in the transaction', async () => {
      const { service, audit, calls } = createService();

      await service.createLoginLink(PARENT_ID, FAMILY_ID, CHILD_ID);

      expect(calls).toEqual([
        'transaction',
        `lockChild ${CHILD_ID}`,
        'audit child.login_link_created',
        `links.create ${CHILD_ID}`,
        'commit',
      ]);
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_XIAOMI,
        action: 'child.login_link_created',
      });
    });

    it('answers with a link to the QR login page that expires in 10 minutes, storing only its hash', async () => {
      const { service, links } = createService();

      const link = await service.createLoginLink(PARENT_ID, FAMILY_ID, CHILD_ID);

      const token = link.url.slice(`${APP_ORIGIN}/child/qr/`.length);
      expect(link).toEqual({
        id: expect.stringMatching(UUID) as unknown,
        url: `${APP_ORIGIN}/child/qr/${token}`,
        expiresAt: '2026-11-22T09:10:00.000Z',
      });
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(links.create).toHaveBeenCalledExactlyOnceWith({
        linkId: link.id,
        childId: CHILD_ID,
        tokenHash: hashToken(token),
        expiresAt: new Date(NOW.getTime() + LOGIN_LINK_LIFETIME_MS),
      });
    });

    it('gives every link an id and a token of its own', async () => {
      const { service } = createService();

      const first = await service.createLoginLink(PARENT_ID, FAMILY_ID, CHILD_ID);
      const second = await service.createLoginLink(PARENT_ID, FAMILY_ID, CHILD_ID);

      expect(first.id).not.toBe(second.id);
      expect(first.url).not.toBe(second.url);
    });

    it('answers a child of another family with child_not_found and stores nothing', async () => {
      const { service, audit, links } = createService();

      expect(await refusalOf(service.createLoginLink(PARENT_ID, 'family-2', CHILD_ID))).toBe(
        'child_not_found',
      );
      expect(links.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('fails, so its transaction and audit event roll back, when Redis does not take the link', async () => {
      const { service, links, calls } = createService();
      const failure = new Error('Redis is not reachable');
      links.create.mockRejectedValueOnce(failure);

      await expect(service.createLoginLink(PARENT_ID, FAMILY_ID, CHILD_ID)).rejects.toBe(failure);
      expect(calls).not.toContain('commit');
    });
  });

  describe('getLoginLinkStatus', () => {
    it('reads the stored state of the link with its expiry time', async () => {
      const { service, links } = createService({ state: stateOf({ status: 'used' }) });

      await expect(service.getLoginLinkStatus(FAMILY_ID, CHILD_ID, LINK_ID)).resolves.toEqual({
        status: 'used',
        expiresAt: '2026-11-22T09:04:00.000Z',
      });
      expect(links.state).toHaveBeenCalledWith(LINK_ID);
    });

    it('reads a link whose state is gone as expired', async () => {
      const { service } = createService();

      await expect(service.getLoginLinkStatus(FAMILY_ID, CHILD_ID, LINK_ID)).resolves.toEqual({
        status: 'expired',
        expiresAt: NOW.toISOString(),
      });
    });

    it("answers another child's link with not_found", async () => {
      const { service } = createService({ state: stateOf({ childId: 'child-2' }) });

      expect(await refusalOf(service.getLoginLinkStatus(FAMILY_ID, CHILD_ID, LINK_ID))).toBe(
        'not_found',
      );
    });

    it('answers a child the family does not have with child_not_found, reading no state', async () => {
      const { service, links } = createService({ state: stateOf() });

      expect(await refusalOf(service.getLoginLinkStatus('family-2', CHILD_ID, LINK_ID))).toBe(
        'child_not_found',
      );
      expect(links.state).not.toHaveBeenCalled();
    });
  });

  describe('devices', () => {
    it("lists the child's devices", async () => {
      const { service, store } = createService();
      store.listDevices.mockResolvedValueOnce([
        { id: DEVICE_ID, name: 'iPad · Safari', rememberedAt: NOW, lastUsedAt: NOW },
      ]);

      await expect(service.listDevices(FAMILY_ID, CHILD_ID)).resolves.toEqual([
        {
          id: DEVICE_ID,
          name: 'iPad · Safari',
          rememberedAt: NOW.toISOString(),
          lastUsedAt: NOW.toISOString(),
        },
      ]);
    });

    it('forgets one device and records it with the device, or none when the id names no device', async () => {
      const { service, audit, calls } = createService();

      await service.revokeDevice(PARENT_ID, FAMILY_ID, CHILD_ID, DEVICE_ID);
      await service.revokeDevice(PARENT_ID, FAMILY_ID, CHILD_ID, undefined);

      expect(calls).toEqual([
        'transaction',
        `deleteDevice ${CHILD_ID} ${DEVICE_ID}`,
        'audit child.devices_revoked',
        'commit',
        'transaction',
        'commit',
      ]);
      expect(audit.record).toHaveBeenCalledExactlyOnceWith(TRANSACTION, {
        ...ON_XIAOMI,
        action: 'child.devices_revoked',
        details: { deviceId: DEVICE_ID },
      });
    });

    it('records nothing for a device that is gone already', async () => {
      const { service, audit } = createService({ devices: false });

      await service.revokeDevice(PARENT_ID, FAMILY_ID, CHILD_ID, DEVICE_ID);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('forgets every device and records it without a device', async () => {
      const { service, audit, calls } = createService();

      await service.revokeAllDevices(PARENT_ID, FAMILY_ID, CHILD_ID);

      expect(calls).toEqual([
        'transaction',
        `deleteDevices ${CHILD_ID}`,
        'audit child.devices_revoked',
        'commit',
      ]);
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_XIAOMI,
        action: 'child.devices_revoked',
        details: {},
      });
    });

    it('records nothing when the child is remembered nowhere', async () => {
      const { service, audit } = createService({ devices: false });

      await service.revokeAllDevices(PARENT_ID, FAMILY_ID, CHILD_ID);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers a child the family does not have with child_not_found and forgets nothing', async () => {
      const { service, store, audit } = createService({ child: false });

      const codes = [
        await refusalOf(service.listDevices(FAMILY_ID, CHILD_ID)),
        await refusalOf(service.revokeDevice(PARENT_ID, FAMILY_ID, CHILD_ID, DEVICE_ID)),
        await refusalOf(service.revokeAllDevices(PARENT_ID, FAMILY_ID, CHILD_ID)),
      ];

      expect(codes).toEqual(['child_not_found', 'child_not_found', 'child_not_found']);
      expect(store.listDevices).not.toHaveBeenCalled();
      expect(store.deleteDevice).not.toHaveBeenCalled();
      expect(store.deleteDevices).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
