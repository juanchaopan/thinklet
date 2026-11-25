import type { ErrorCode } from '@thinklet/contracts';
import { RateLimitedError } from '../../infrastructure/errors/api-error.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FamiliesService } from '../family/families.service.js';
import {
  canSetPasswordWithAccount,
  type ChildLoginRepository,
  type ChildLoginStore,
  type LoginCandidate,
} from './child-login.repository.js';
import {
  ChildLoginService,
  type AccountLogin,
  type Browser,
  type CompletedLogin,
} from './child-login.service.js';
import type { ChildPasswords } from './child-passwords.js';
import { DEVICE_LIFETIME_MS } from './device-cookie.js';
import type { ActiveLoginLink } from './login-links.js';
import { hashToken, isWellFormedToken, newToken } from './tokens.js';

/** The api instance's clock, which no time of a login is taken from. */
const NOW = new Date('2026-11-22T09:00:00.000Z');
/** The database's clock once the child is locked, seconds off the instance's. */
const DATABASE_NOW = new Date('2026-11-22T09:00:06.250Z');
/** When a browser remembered at the database's time stops being remembered. */
const REMEMBERED_UNTIL = new Date(DATABASE_NOW.getTime() + DEVICE_LIFETIME_MS);
/** Until when a child without a password may still set one with the account, by the database's clock. */
const SETUP_UNTIL = new Date(DATABASE_NOW.getTime() + 60 * 60 * 1000);
const FAMILY_ID = '5d1e6f70-8192-4a3b-8c4d-5e6f708192a3';
const OTHER_FAMILY_ID = '8a40b1c2-d3e4-4f5a-8b6c-7d8e9f0a1b2c';
const CHILD_ID = '3f9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const SIBLING_ID = '41f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
const COUSIN_ID = 'c3d9e0f1-a2b3-4c4d-9e5f-6a7b8c9d0e1f';
const LINK_ID = '7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d';
const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw';
const OTHER_HASH = '$argon2id$v=19$m=19456,t=2,p=1$b3RoZXJzYWx0$b3RoZXItaGFzaA';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** The address of the client the logins come from, a documentation address (RFC 5737). */
const CLIENT_IP = '203.0.113.7';
const LOGIN = { code: '7KQ4MZ', account: 'xiaomi', password: 'secret1', remember: false };
const FIRST_PASSWORD = {
  code: '7KQ4MZ',
  account: 'xiaomi',
  password: 'new secret',
  remember: false,
};
const XIAOMI: LoginCandidate = {
  id: CHILD_ID,
  familyId: FAMILY_ID,
  nickname: '小米',
  passwordHash: HASH,
  passwordSetupUntil: null,
};
/** Xiaomi without a password and no time left to set one with the account. */
const XIAOMI_WITHOUT_PASSWORD: LoginCandidate = { ...XIAOMI, passwordHash: null };
/** Xiaomi without a password, who may still set one with the account. */
const XIAOMI_SETTING_UP: LoginCandidate = {
  ...XIAOMI_WITHOUT_PASSWORD,
  passwordSetupUntil: SETUP_UNTIL,
};
const FRESH_BROWSER: Browser = { deviceToken: undefined, userAgent: IPAD, clientIp: CLIENT_IP };

/** The transaction the repository double hands its work, which the audit events are written with. */
const TRANSACTION = { transaction: 'child-login' };

/** Xiaomi's login link that the token's hash opens, as Redis holds it while it can be used. */
const activeLink = (tokenHash: string): ActiveLoginLink => ({
  linkId: LINK_ID,
  childId: CHILD_ID,
  tokenHash,
  expiresAt: '2026-11-22T09:05:00.000Z',
});

/** Asserts that the call is refused with the api error of the code. */
const expectRefusal = (call: Promise<unknown>, code: ErrorCode) =>
  expect(call).rejects.toMatchObject({ code });

/** The login with the account that signed the child in; fails the test when it asked for a password instead. */
async function signedIn(login: Promise<AccountLogin>): Promise<CompletedLogin> {
  const answer = await login;
  if ('needsPassword' in answer) {
    throw new Error('The login asked for a password to be set');
  }
  return answer;
}

/** A mock's calls in the order of every mock's calls. */
interface CalledMock {
  mock: { invocationCallOrder: number[] };
}

/** When the mock was first called, among every mock's calls; NaN when it never was. */
const firstCallOf = (mock: CalledMock) => mock.mock.invocationCallOrder[0] ?? Number.NaN;

/** When the mock was last called, among every mock's calls; NaN when it never was. */
const lastCallOf = (mock: CalledMock) => mock.mock.invocationCallOrder.at(-1) ?? Number.NaN;

/** Asserts that every mock was called, each first called after the one before it. */
function expectCalledInOrder(...mocks: CalledMock[]): void {
  const firstCalls = mocks.map(firstCallOf);
  expect(firstCalls.every(Number.isFinite)).toBe(true);
  expect(firstCalls).toEqual([...firstCalls].sort((a, b) => a - b));
}

describe('canSetPasswordWithAccount', () => {
  it('lets a child without a password set one until the time left for it, not at that time or after', () => {
    expect(canSetPasswordWithAccount(XIAOMI_SETTING_UP, DATABASE_NOW)).toBe(true);
    expect(canSetPasswordWithAccount(XIAOMI_SETTING_UP, SETUP_UNTIL)).toBe(false);
    expect(canSetPasswordWithAccount(XIAOMI_SETTING_UP, new Date(SETUP_UNTIL.getTime() + 1))).toBe(
      false,
    );
  });

  it('lets no child set one who has a password or was given no time for it', () => {
    expect(canSetPasswordWithAccount({ ...XIAOMI, passwordSetupUntil: SETUP_UNTIL }, NOW)).toBe(
      false,
    );
    expect(canSetPasswordWithAccount(XIAOMI_WITHOUT_PASSWORD, NOW)).toBe(false);
  });
});

describe('ChildLoginService', () => {
  const store = {
    findLoginCandidate: vi.fn<ChildLoginStore['findLoginCandidate']>(),
    findCandidate: vi.fn<ChildLoginStore['findCandidate']>(),
    lockChild: vi.fn<ChildLoginStore['lockChild']>(),
    databaseNow: vi.fn<ChildLoginStore['databaseNow']>(),
    deleteExpiredDevices: vi.fn<ChildLoginStore['deleteExpiredDevices']>(),
    moveFamilyDevices: vi.fn<ChildLoginStore['moveFamilyDevices']>(),
    setPassword: vi.fn<ChildLoginStore['setPassword']>(),
    rememberDevice: vi.fn<ChildLoginStore['rememberDevice']>(),
    renewDevice: vi.fn<ChildLoginStore['renewDevice']>(),
    forgetDevice: vi.fn<ChildLoginStore['forgetDevice']>(),
    listRemembered: vi.fn<ChildLoginStore['listRemembered']>(),
  };
  /** The login links in Redis, as the repository reads and uses them: an active link for every token unless a test says otherwise. */
  const links = {
    find: vi.fn<ChildLoginRepository['findLink']>(),
    take: vi.fn<ChildLoginRepository['takeLink']>(),
  };
  /** Called once a transaction's work has resolved, as its commit. */
  const committed = vi.fn<() => void>();
  const transaction = vi.fn(
    async (work: (s: ChildLoginStore, transaction: unknown) => Promise<unknown>) => {
      const result = await work(store as unknown as ChildLoginStore, TRANSACTION);
      committed();
      return result;
    },
  );
  const repository = {
    ...store,
    findLink: links.find,
    takeLink: links.take,
    transaction,
  } as unknown as ChildLoginRepository;
  const families = {
    findIdByCode: vi.fn<FamiliesService['findIdByCode']>(),
    codesOf: vi.fn<FamiliesService['codesOf']>(),
  };
  /** The hashing and verifying of the children's passwords. */
  const hasher = {
    hash: vi.fn<ChildPasswords['hash']>(),
    verify: vi.fn<ChildPasswords['verify']>(),
  };
  /** The limits on the logins that check a password, letting every attempt through unless a test says otherwise. */
  const limits = {
    attempt: vi.fn(
      (_clientIp: string | undefined, _subject: unknown, login: () => Promise<unknown>) => login(),
    ),
  };
  const audit = { record: vi.fn<AuditService['record']>() };
  let service: ChildLoginService;

  /** The logins whose family code and account match no child, each arranged on the doubles. */
  const noSuchChild: Array<[string, () => void]> = [
    ['a code no family has', () => families.findIdByCode.mockResolvedValue(undefined)],
    [
      'an account the family does not have',
      () => store.findLoginCandidate.mockResolvedValue(undefined),
    ],
  ];

  /** Arranges Xiaomi as a child without a password who may still set one with the account. */
  const arrangeSettingUp = () => {
    store.findLoginCandidate.mockResolvedValue(XIAOMI_SETTING_UP);
    store.lockChild.mockResolvedValue(XIAOMI_SETTING_UP);
    hasher.hash.mockResolvedValue(HASH);
  };

  /**
   * Every kind of successful login, each arranged on the doubles, of a
   * browser with the given device token, the child to be remembered.
   */
  const everyLogin: Array<[string, (deviceToken: string) => Promise<CompletedLogin>]> = [
    [
      'with the account and the password',
      (deviceToken) => {
        hasher.verify.mockResolvedValue(true);
        return signedIn(
          service.login({ ...LOGIN, remember: true }, { ...FRESH_BROWSER, deviceToken }),
        );
      },
    ],
    [
      'setting the first password with the account',
      (deviceToken) => {
        arrangeSettingUp();
        return service.setPasswordWithAccount(
          { ...FIRST_PASSWORD, remember: true },
          { ...FRESH_BROWSER, deviceToken },
        );
      },
    ],
    [
      'by the avatar',
      (deviceToken) => {
        store.renewDevice.mockResolvedValue(true);
        return service.loginRemembered(CHILD_ID, deviceToken);
      },
    ],
    [
      'setting the first password on a link',
      (deviceToken) => {
        store.findCandidate.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);
        store.lockChild.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);
        hasher.hash.mockResolvedValue(HASH);
        return service.setPasswordWithLink(
          newToken().token,
          { password: 'new secret', remember: true },
          { ...FRESH_BROWSER, deviceToken },
        );
      },
    ],
    [
      'with the password on a link',
      (deviceToken) => {
        hasher.verify.mockResolvedValue(true);
        return service.loginWithLink(
          newToken().token,
          { password: 'secret1', remember: true },
          { ...FRESH_BROWSER, deviceToken },
        );
      },
    ],
  ];

  /** The logins that take a password or a link, each of which gives the browser a new device token. */
  const loginsWithAPasswordOrALink = everyLogin.filter(([name]) => name !== 'by the avatar');

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const mock of [
      ...Object.values(store),
      ...Object.values(links),
      ...Object.values(families),
    ]) {
      mock.mockReset();
    }
    transaction.mockClear();
    committed.mockReset();
    hasher.hash.mockReset();
    hasher.verify.mockReset().mockResolvedValue(false);
    limits.attempt.mockClear();
    audit.record.mockReset().mockResolvedValue();
    families.findIdByCode.mockResolvedValue(FAMILY_ID);
    store.findLoginCandidate.mockResolvedValue(XIAOMI);
    store.findCandidate.mockResolvedValue(XIAOMI);
    store.lockChild.mockResolvedValue(XIAOMI);
    store.databaseNow.mockResolvedValue(DATABASE_NOW);
    store.deleteExpiredDevices.mockResolvedValue();
    store.moveFamilyDevices.mockResolvedValue();
    links.find.mockImplementation((tokenHash) => Promise.resolve(activeLink(tokenHash)));
    links.take.mockResolvedValue(true);
    service = new ChildLoginService(
      repository,
      families as unknown as FamiliesService,
      { ...hasher, ...limits } as unknown as ChildPasswords,
      audit as unknown as AuditService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('login', () => {
    it("logs the child in with the family's code, the account and the right password, recording no audit event", async () => {
      hasher.verify.mockResolvedValue(true);

      const login = await service.login(LOGIN, FRESH_BROWSER);

      expect(login).toEqual({
        child: { id: CHILD_ID, nickname: '小米' },
        deviceToken: undefined,
        issuedAt: DATABASE_NOW,
      });
      expect(families.findIdByCode).toHaveBeenCalledWith('7KQ4MZ');
      expect(store.findLoginCandidate).toHaveBeenCalledWith(FAMILY_ID, 'xiaomi');
      expect(hasher.verify).toHaveBeenCalledWith('secret1', HASH);
      expect(store.lockChild).toHaveBeenCalledWith(CHILD_ID);
      expect(audit.record).not.toHaveBeenCalled();
      expect(links.find).not.toHaveBeenCalled();
    });

    it("verifies the password before the transaction, then reads the database's clock and writes the device under the child's lock", async () => {
      hasher.verify.mockResolvedValue(true);

      await service.login({ ...LOGIN, remember: true }, FRESH_BROWSER);

      expectCalledInOrder(
        hasher.verify,
        transaction,
        store.lockChild,
        store.databaseNow,
        store.rememberDevice,
        committed,
      );
    });

    it.each<[string, Partial<typeof LOGIN>]>([
      ['with a password typed', {}],
      ['without a password', { password: undefined }],
    ])(
      'answers a child who may still set a password %s that it has to set one, signing nobody in',
      async (_case, change) => {
        arrangeSettingUp();

        const answer = await service.login({ ...LOGIN, ...change }, FRESH_BROWSER);

        expect(answer).toEqual({ needsPassword: true, id: CHILD_ID, nickname: '小米' });
        expect(store.databaseNow).toHaveBeenCalledOnce();
        expect(hasher.verify).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it.each<[string, () => void]>([
      ...noSuchChild,
      [
        'a child without a password who was given no time to set one',
        () => store.findLoginCandidate.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD),
      ],
      [
        'a child without a password whose time to set one has run out by the database’s clock',
        () =>
          store.findLoginCandidate.mockResolvedValue({
            ...XIAOMI_SETTING_UP,
            passwordSetupUntil: DATABASE_NOW,
          }),
      ],
    ])(
      'refuses %s with login_failed, still checking the password with no hash to check it against',
      async (_case, arrange) => {
        arrange();
        hasher.verify.mockResolvedValue(true);

        await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');
        expect(hasher.verify).toHaveBeenCalledExactlyOnceWith('secret1', null);
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it('refuses a wrong password with the same login_failed', async () => {
      await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');
      expect(hasher.verify).toHaveBeenCalledWith('secret1', HASH);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('refuses a child who has a password with login_failed when none is given, still checking one', async () => {
      hasher.verify.mockResolvedValue(true);

      await expectRefusal(
        service.login({ ...LOGIN, password: undefined }, FRESH_BROWSER),
        'login_failed',
      );
      expect(hasher.verify).toHaveBeenCalledExactlyOnceWith('', HASH);
      expect(store.databaseNow).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each<[string, LoginCandidate | undefined]>([
      ['reset', XIAOMI_WITHOUT_PASSWORD],
      ['changed', { ...XIAOMI, passwordHash: OTHER_HASH }],
      ['deleted with the child', undefined],
    ])(
      'refuses with login_failed a password %s after it was verified, remembering nothing',
      async (_case, locked) => {
        hasher.verify.mockResolvedValue(true);
        store.lockChild.mockResolvedValue(locked);

        await expectRefusal(
          service.login(
            { ...LOGIN, remember: true },
            { ...FRESH_BROWSER, deviceToken: newToken().token },
          ),
          'login_failed',
        );
        expect(store.moveFamilyDevices).not.toHaveBeenCalled();
        expect(store.rememberDevice).not.toHaveBeenCalled();
        expect(committed).not.toHaveBeenCalled();
      },
    );
  });

  describe('setPasswordWithAccount', () => {
    beforeEach(arrangeSettingUp);

    it("hashes the child's first password, stores it under the lock and logs the child in", async () => {
      const login = await service.setPasswordWithAccount(FIRST_PASSWORD, FRESH_BROWSER);

      expect(hasher.hash).toHaveBeenCalledExactlyOnceWith('new secret');
      expect(store.lockChild).toHaveBeenCalledExactlyOnceWith(CHILD_ID);
      expect(store.setPassword).toHaveBeenCalledExactlyOnceWith(CHILD_ID, HASH);
      expect(login.child).toEqual({ id: CHILD_ID, nickname: '小米' });
      expect([login.deviceToken, login.issuedAt]).toEqual([undefined, DATABASE_NOW]);
    });

    it('records the password the child set with the account, by the child, in the transaction', async () => {
      await service.setPasswordWithAccount(FIRST_PASSWORD, FRESH_BROWSER);

      expect(audit.record).toHaveBeenCalledExactlyOnceWith(TRANSACTION, {
        actor: { kind: 'child', id: CHILD_ID },
        action: 'child.password_set',
        targetId: CHILD_ID,
        familyId: FAMILY_ID,
        details: { via: 'account' },
      });
      expectCalledInOrder(store.setPassword, audit.record, committed);
    });

    it("hashes the password before the transaction, then checks the time again by the database's clock under the child's lock", async () => {
      await service.setPasswordWithAccount({ ...FIRST_PASSWORD, remember: true }, FRESH_BROWSER);

      expectCalledInOrder(
        hasher.hash,
        transaction,
        store.lockChild,
        store.setPassword,
        store.rememberDevice,
        committed,
      );
      expect(store.databaseNow).toHaveBeenCalledTimes(2);
      expect(lastCallOf(store.databaseNow)).toBeGreaterThan(firstCallOf(store.lockChild));
    });

    it.each<[string, () => void]>([
      ...noSuchChild,
      ['a child who has a password', () => store.findLoginCandidate.mockResolvedValue(XIAOMI)],
      [
        'a child who was given no time to set one with the account',
        () => store.findLoginCandidate.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD),
      ],
      [
        'a child whose time has run out by the database’s clock',
        () => store.databaseNow.mockResolvedValue(new Date(SETUP_UNTIL.getTime() + 1)),
      ],
    ])('refuses %s with login_failed, hashing nothing', async (_case, arrange) => {
      arrange();

      await expectRefusal(
        service.setPasswordWithAccount(FIRST_PASSWORD, FRESH_BROWSER),
        'login_failed',
      );
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each<[string, LoginCandidate | undefined]>([
      ['set by another login', XIAOMI],
      ['reset with no time left', XIAOMI_WITHOUT_PASSWORD],
      ['gone with the child', undefined],
    ])(
      'refuses with login_failed a password %s once the child is locked, writing nothing',
      async (_case, locked) => {
        store.lockChild.mockResolvedValue(locked);

        await expectRefusal(
          service.setPasswordWithAccount({ ...FIRST_PASSWORD, remember: true }, FRESH_BROWSER),
          'login_failed',
        );
        expect(store.setPassword).not.toHaveBeenCalled();
        expect(store.rememberDevice).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
        expect(committed).not.toHaveBeenCalled();
      },
    );

    it('refuses with login_failed when the time runs out while the password is hashed', async () => {
      store.databaseNow.mockResolvedValueOnce(DATABASE_NOW).mockResolvedValueOnce(SETUP_UNTIL);

      await expectRefusal(
        service.setPasswordWithAccount(FIRST_PASSWORD, FRESH_BROWSER),
        'login_failed',
      );
      expect(store.setPassword).not.toHaveBeenCalled();
      expect(committed).not.toHaveBeenCalled();
    });
  });

  describe("every login's time and expired devices", () => {
    it.each(everyLogin)(
      "issues a login %s at the database's time, not the instance's clock",
      async (_case, logIn) => {
        const login = await logIn(newToken().token);

        expect(login.issuedAt).toEqual(DATABASE_NOW);
        expect(login.issuedAt).not.toEqual(NOW);
      },
    );

    it.each(everyLogin)(
      "deletes the child's devices expired by the database's time on a login %s, once the child is locked",
      async (_case, logIn) => {
        await logIn(newToken().token);

        expect(store.deleteExpiredDevices).toHaveBeenCalledExactlyOnceWith(CHILD_ID, DATABASE_NOW);
        expectCalledInOrder(transaction, store.lockChild, store.deleteExpiredDevices, committed);
        const lastClockRead = lastCallOf(store.databaseNow);
        expect(lastClockRead).toBeGreaterThan(firstCallOf(store.lockChild));
        expect(lastClockRead).toBeLessThan(firstCallOf(store.deleteExpiredDevices));
      },
    );

    it('deletes no expired device when the child is gone by the lock', async () => {
      store.lockChild.mockResolvedValue(undefined);

      await expectRefusal(service.loginRemembered(CHILD_ID, newToken().token), 'remember_invalid');
      expect(store.deleteExpiredDevices).not.toHaveBeenCalled();
    });

    it('commits no deleting when the login is refused under the lock', async () => {
      store.renewDevice.mockResolvedValue(false);

      await expectRefusal(service.loginRemembered(CHILD_ID, newToken().token), 'remember_invalid');
      expect(store.deleteExpiredDevices).toHaveBeenCalled();
      expect(committed).not.toHaveBeenCalled();
    });
  });

  describe('the limits of a login', () => {
    it('counts a login for the child found from where the browser is, with the password checked within the limits', async () => {
      await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');

      expect(limits.attempt).toHaveBeenCalledExactlyOnceWith(
        CLIENT_IP,
        { childId: CHILD_ID },
        expect.any(Function),
      );
      expectCalledInOrder(store.findLoginCandidate, limits.attempt, hasher.verify);
    });

    it.each(noSuchChild)(
      'counts a login with %s for the code and account typed',
      async (_case, arrange) => {
        arrange();

        await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');

        expect(limits.attempt).toHaveBeenCalledWith(
          CLIENT_IP,
          { code: '7KQ4MZ', account: 'xiaomi' },
          expect.any(Function),
        );
      },
    );

    it('passes on a browser without a client address for the limits to decide', async () => {
      hasher.verify.mockResolvedValue(true);

      await service.login(LOGIN, { ...FRESH_BROWSER, clientIp: undefined });

      expect(limits.attempt).toHaveBeenCalledWith(
        undefined,
        { childId: CHILD_ID },
        expect.any(Function),
      );
    });

    it('refuses a source at its limit with rate_limited before the password is checked', async () => {
      limits.attempt.mockRejectedValueOnce(new RateLimitedError(412));

      await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'rate_limited');
      expect(hasher.verify).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('asks a child who may set a password to set one within the limits, before anything is checked', async () => {
      arrangeSettingUp();
      limits.attempt.mockRejectedValueOnce(new RateLimitedError(412));

      await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'rate_limited');
      expect(store.databaseNow).not.toHaveBeenCalled();
    });

    it('counts setting the first password with the account for the child found, before anything is hashed', async () => {
      arrangeSettingUp();

      await service.setPasswordWithAccount(FIRST_PASSWORD, FRESH_BROWSER);

      expect(limits.attempt).toHaveBeenCalledExactlyOnceWith(
        CLIENT_IP,
        { childId: CHILD_ID },
        expect.any(Function),
      );
      expectCalledInOrder(store.findLoginCandidate, limits.attempt, hasher.hash);
    });

    it.each(noSuchChild)(
      'counts setting a password with %s for the code and account typed',
      async (_case, arrange) => {
        arrange();

        await expectRefusal(
          service.setPasswordWithAccount(FIRST_PASSWORD, FRESH_BROWSER),
          'login_failed',
        );

        expect(limits.attempt).toHaveBeenCalledWith(
          CLIENT_IP,
          { code: '7KQ4MZ', account: 'xiaomi' },
          expect.any(Function),
        );
      },
    );

    it('refuses setting a password from a source at its limit with rate_limited, hashing nothing', async () => {
      arrangeSettingUp();
      limits.attempt.mockRejectedValueOnce(new RateLimitedError(60));

      await expectRefusal(
        service.setPasswordWithAccount(FIRST_PASSWORD, FRESH_BROWSER),
        'rate_limited',
      );
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('counts a login on a link for the link’s child, after the link is found', async () => {
      hasher.verify.mockResolvedValue(true);

      await service.loginWithLink(
        newToken().token,
        { password: 'secret1', remember: false },
        FRESH_BROWSER,
      );

      expect(limits.attempt).toHaveBeenCalledExactlyOnceWith(
        CLIENT_IP,
        { childId: CHILD_ID },
        expect.any(Function),
      );
      expectCalledInOrder(links.find, store.findCandidate, limits.attempt, hasher.verify);
    });

    it('refuses a source at its limit on a link with rate_limited, leaving the link unused', async () => {
      limits.attempt.mockRejectedValueOnce(new RateLimitedError(60));

      await expectRefusal(
        service.loginWithLink(
          newToken().token,
          { password: 'secret1', remember: true },
          FRESH_BROWSER,
        ),
        'rate_limited',
      );
      expect(hasher.verify).not.toHaveBeenCalled();
      expect(links.take).not.toHaveBeenCalled();
    });

    it('does not limit a link that cannot be used, or one whose child still has to set a password', async () => {
      links.find.mockResolvedValueOnce(undefined);
      await expectRefusal(
        service.loginWithLink(
          newToken().token,
          { password: 'secret1', remember: true },
          FRESH_BROWSER,
        ),
        'link_invalid',
      );
      store.findCandidate.mockResolvedValueOnce(XIAOMI_WITHOUT_PASSWORD);
      await expectRefusal(
        service.loginWithLink(
          newToken().token,
          { password: 'secret1', remember: true },
          FRESH_BROWSER,
        ),
        'password_not_set',
      );

      expect(limits.attempt).not.toHaveBeenCalled();
    });

    it('does not limit setting a first password on a link or a remembered login', async () => {
      store.findCandidate.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);
      store.lockChild.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);
      store.renewDevice.mockResolvedValue(true);
      hasher.hash.mockResolvedValue(HASH);

      await service.setPasswordWithLink(
        newToken().token,
        { password: 'new secret', remember: false },
        FRESH_BROWSER,
      );
      await service.loginRemembered(CHILD_ID, newToken().token);

      expect(limits.attempt).not.toHaveBeenCalled();
    });
  });

  describe('remembering the browser on a login', () => {
    beforeEach(() => {
      hasher.verify.mockResolvedValue(true);
    });

    it("gives a browser without a device token a new one and remembers the child for 30 days from the database's time", async () => {
      const login = await signedIn(service.login({ ...LOGIN, remember: true }, FRESH_BROWSER));

      expect(isWellFormedToken(login.deviceToken)).toBe(true);
      expect(store.rememberDevice).toHaveBeenCalledWith({
        childId: CHILD_ID,
        tokenHash: hashToken(login.deviceToken ?? ''),
        name: 'iPad · Safari',
        now: DATABASE_NOW,
        expiresAt: REMEMBERED_UNTIL,
      });
      expect(store.moveFamilyDevices).not.toHaveBeenCalled();
    });

    it("gives a browser with a device token a new one, moving the family's valid devices to it before the child's own row", async () => {
      const old = newToken();

      const login = await signedIn(
        service.login(
          { ...LOGIN, remember: true },
          { deviceToken: old.token, userAgent: undefined, clientIp: CLIENT_IP },
        ),
      );

      expect(isWellFormedToken(login.deviceToken)).toBe(true);
      expect(login.deviceToken).not.toBe(old.token);
      const hash = hashToken(login.deviceToken ?? '');
      expect(store.moveFamilyDevices).toHaveBeenCalledExactlyOnceWith({
        familyId: FAMILY_ID,
        fromTokenHash: old.hash,
        toTokenHash: hash,
        now: DATABASE_NOW,
      });
      expect(store.rememberDevice).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ childId: CHILD_ID, tokenHash: hash, name: '未知设备' }),
      );
      expectCalledInOrder(
        store.deleteExpiredDevices,
        store.moveFamilyDevices,
        store.rememberDevice,
        committed,
      );
    });

    it("moves the devices of the locked child's family, whatever family the browser's other children are in", async () => {
      store.lockChild.mockResolvedValue({ ...XIAOMI, familyId: OTHER_FAMILY_ID });

      await service.login(
        { ...LOGIN, remember: true },
        { ...FRESH_BROWSER, deviceToken: newToken().token },
      );

      expect(store.moveFamilyDevices).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: OTHER_FAMILY_ID }),
      );
    });

    it.each(loginsWithAPasswordOrALink)(
      'gives the browser a new device token on a login %s, never the one it had',
      async (_case, logIn) => {
        const planted = newToken();

        const login = await logIn(planted.token);

        expect(isWellFormedToken(login.deviceToken)).toBe(true);
        expect(login.deviceToken).not.toBe(planted.token);
        expect(store.moveFamilyDevices).toHaveBeenCalledExactlyOnceWith({
          familyId: FAMILY_ID,
          fromTokenHash: planted.hash,
          toTokenHash: hashToken(login.deviceToken ?? ''),
          now: DATABASE_NOW,
        });
        expect(store.rememberDevice).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ tokenHash: hashToken(login.deviceToken ?? '') }),
        );
      },
    );

    it("keeps the browser's device token on a login by the avatar, moving nothing", async () => {
      const { token } = newToken();
      store.renewDevice.mockResolvedValue(true);

      const login = await service.loginRemembered(CHILD_ID, token);

      expect(login.deviceToken).toBe(token);
      expect(store.moveFamilyDevices).not.toHaveBeenCalled();
      expect(store.rememberDevice).not.toHaveBeenCalled();
    });

    it('forgets the child on the browser when not remembered, and leaves its cookie', async () => {
      const { token, hash } = newToken();

      const login = await signedIn(service.login(LOGIN, { ...FRESH_BROWSER, deviceToken: token }));

      expect(login.deviceToken).toBeUndefined();
      expect(store.forgetDevice).toHaveBeenCalledWith(CHILD_ID, hash);
      expect(store.rememberDevice).not.toHaveBeenCalled();
      expect(store.moveFamilyDevices).not.toHaveBeenCalled();
      expectCalledInOrder(store.lockChild, store.forgetDevice, committed);
    });

    it('has nothing to forget on a browser without a device token', async () => {
      await service.login(LOGIN, FRESH_BROWSER);

      expect(store.forgetDevice).not.toHaveBeenCalled();
    });
  });

  describe('remembered', () => {
    it('lists nothing without a device token, without a lookup', async () => {
      await expect(service.remembered(undefined)).resolves.toEqual([]);
      expect(store.listRemembered).not.toHaveBeenCalled();
    });

    it("lists the remembered children with their families' current codes, once per family", async () => {
      const { token, hash } = newToken();
      store.listRemembered.mockResolvedValue([
        { childId: CHILD_ID, familyId: FAMILY_ID, nickname: '小米', account: 'xiaomi' },
        { childId: COUSIN_ID, familyId: OTHER_FAMILY_ID, nickname: '豆豆', account: 'doudou' },
        { childId: SIBLING_ID, familyId: FAMILY_ID, nickname: '阿乐', account: 'ale2019' },
      ]);
      families.codesOf.mockResolvedValue(
        new Map([
          [FAMILY_ID, '7KQ4MZ'],
          [OTHER_FAMILY_ID, 'P2X9WD'],
        ]),
      );

      const remembered = await service.remembered(token);

      expect(store.listRemembered).toHaveBeenCalledWith(hash);
      expect(families.codesOf).toHaveBeenCalledWith([FAMILY_ID, OTHER_FAMILY_ID]);
      expect(remembered).toEqual([
        { childId: CHILD_ID, nickname: '小米', familyCode: '7KQ4MZ', account: 'xiaomi' },
        { childId: COUSIN_ID, nickname: '豆豆', familyCode: 'P2X9WD', account: 'doudou' },
        { childId: SIBLING_ID, nickname: '阿乐', familyCode: '7KQ4MZ', account: 'ale2019' },
      ]);
    });
  });

  describe('loginRemembered', () => {
    it("logs the child in and renews the browser for 30 days with the same token, under the child's lock", async () => {
      const { token, hash } = newToken();
      store.renewDevice.mockResolvedValue(true);

      const login = await service.loginRemembered(CHILD_ID, token);

      expect(login).toEqual({
        child: { id: CHILD_ID, nickname: '小米' },
        deviceToken: token,
        issuedAt: DATABASE_NOW,
      });
      expect(store.lockChild).toHaveBeenCalledWith(CHILD_ID);
      expect(store.renewDevice).toHaveBeenCalledWith(
        CHILD_ID,
        hash,
        DATABASE_NOW,
        REMEMBERED_UNTIL,
      );
      expectCalledInOrder(transaction, store.lockChild, store.renewDevice, committed);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses a browser without a device token with remember_invalid, without a transaction', async () => {
      await expectRefusal(service.loginRemembered(CHILD_ID, undefined), 'remember_invalid');
      expect(transaction).not.toHaveBeenCalled();
    });

    it('refuses a browser that does not remember the child, or no longer, with remember_invalid', async () => {
      store.renewDevice.mockResolvedValue(false);

      await expectRefusal(service.loginRemembered(CHILD_ID, newToken().token), 'remember_invalid');
    });

    it('refuses a child deleted by then with remember_invalid, renewing nothing', async () => {
      store.lockChild.mockResolvedValue(undefined);

      await expectRefusal(service.loginRemembered(CHILD_ID, newToken().token), 'remember_invalid');
      expect(store.renewDevice).not.toHaveBeenCalled();
    });
  });

  /** The ways a link cannot be used when it is read, each arranged on the doubles and answered as link_invalid. */
  const unusableLinks: Array<[string, () => void]> = [
    [
      'a link that is gone: never made, used, revoked or expired',
      () => links.find.mockResolvedValue(undefined),
    ],
    ['the link of a deleted child', () => store.findCandidate.mockResolvedValue(undefined)],
  ];

  /** The ways a link stops working between its reading and its use, each answered as link_invalid. */
  const linksLostUnderLock: Array<[string, () => void]> = [
    [
      'gone by the time the child is locked',
      () => links.find.mockResolvedValueOnce(activeLink('')).mockResolvedValueOnce(undefined),
    ],
    ['used by another login just before Redis takes it', () => links.take.mockResolvedValue(false)],
  ];

  describe('linkInfo', () => {
    it('tells whose link it is and whether the child still has to set a password, using nothing', async () => {
      const { token, hash } = newToken();
      store.findCandidate
        .mockResolvedValueOnce(XIAOMI)
        .mockResolvedValueOnce(XIAOMI_WITHOUT_PASSWORD);

      const withPassword = await service.linkInfo(token);
      const withoutPassword = await service.linkInfo(token);

      expect(links.find).toHaveBeenCalledWith(hash);
      expect(store.findCandidate).toHaveBeenCalledWith(CHILD_ID);
      expect(withPassword).toEqual({ childId: CHILD_ID, nickname: '小米', needsPassword: false });
      expect(withoutPassword).toEqual({ childId: CHILD_ID, nickname: '小米', needsPassword: true });
      expect(links.take).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each(unusableLinks)('answers %s with link_invalid', async (_case, arrange) => {
      arrange();

      await expectRefusal(service.linkInfo(newToken().token), 'link_invalid');
    });

    it('passes a failure of Redis on as it is', async () => {
      const failure = new Error('Redis is not reachable');
      links.find.mockRejectedValue(failure);

      await expect(service.linkInfo(newToken().token)).rejects.toBe(failure);
    });
  });

  describe('setPasswordWithLink', () => {
    const request = { password: 'new secret', remember: true };

    beforeEach(() => {
      store.findCandidate.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);
      store.lockChild.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);
      hasher.hash.mockResolvedValue(HASH);
    });

    it("sets the child's first password, uses the link and logs the child in", async () => {
      const { token, hash } = newToken();

      const login = await service.setPasswordWithLink(token, request, FRESH_BROWSER);

      expect(login.child).toEqual({ id: CHILD_ID, nickname: '小米' });
      expect(links.find).toHaveBeenCalledWith(hash);
      expect(store.lockChild).toHaveBeenCalledWith(CHILD_ID);
      expect(hasher.hash).toHaveBeenCalledWith('new secret');
      expect(store.setPassword).toHaveBeenCalledWith(CHILD_ID, HASH);
      expect(links.take).toHaveBeenCalledExactlyOnceWith(activeLink(hash));
    });

    it('sets the password whether or not the child still has time to set one with the account', async () => {
      store.findCandidate.mockResolvedValue(XIAOMI_SETTING_UP);
      store.lockChild.mockResolvedValue(XIAOMI_SETTING_UP);

      await service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER);

      expect(store.setPassword).toHaveBeenCalledWith(CHILD_ID, HASH);
    });

    it('records the password the child set on a link, by the child, in the transaction', async () => {
      await service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER);

      expect(audit.record).toHaveBeenCalledExactlyOnceWith(TRANSACTION, {
        actor: { kind: 'child', id: CHILD_ID },
        action: 'child.password_set',
        targetId: CHILD_ID,
        familyId: FAMILY_ID,
        details: { via: 'qr' },
      });
      expectCalledInOrder(store.setPassword, audit.record, links.take, committed);
    });

    it('hashes the password before the transaction, and uses the link last under the lock', async () => {
      await service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER);

      expectCalledInOrder(
        hasher.hash,
        transaction,
        store.lockChild,
        store.setPassword,
        store.rememberDevice,
        links.take,
        committed,
      );
      expect(links.find).toHaveBeenCalledTimes(2);
    });

    it('refuses a child who has a password with password_already_set, hashing nothing', async () => {
      store.findCandidate.mockResolvedValue(XIAOMI);

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'password_already_set',
      );
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses with password_already_set a password set under the lock first, leaving the link unused', async () => {
      store.lockChild.mockResolvedValue(XIAOMI);

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'password_already_set',
      );
      expect(store.setPassword).not.toHaveBeenCalled();
      expect(links.take).not.toHaveBeenCalled();
      expect(store.rememberDevice).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each(unusableLinks)(
      'answers %s with link_invalid, hashing nothing',
      async (_case, arrange) => {
        arrange();

        await expectRefusal(
          service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
          'link_invalid',
        );
        expect(hasher.hash).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it.each(linksLostUnderLock)(
      'answers a link %s with link_invalid, its writes not committed',
      async (_case, arrange) => {
        arrange();

        await expectRefusal(
          service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
          'link_invalid',
        );
        expect(committed).not.toHaveBeenCalled();
      },
    );

    it('answers a link gone by the time the child is locked before setting anything', async () => {
      links.find.mockResolvedValueOnce(activeLink('')).mockResolvedValueOnce(undefined);

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'link_invalid',
      );
      expect(store.setPassword).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(links.take).not.toHaveBeenCalled();
    });

    it('answers a child deleted by then with link_invalid', async () => {
      store.lockChild.mockResolvedValue(undefined);

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'link_invalid',
      );
      expect(links.find).toHaveBeenCalledTimes(1);
      expect(links.take).not.toHaveBeenCalled();
    });
  });

  describe('loginWithLink', () => {
    const request = { password: 'secret1', remember: true };

    beforeEach(() => {
      hasher.verify.mockResolvedValue(true);
    });

    it('logs the child in with the right password and uses the link, recording no audit event', async () => {
      const { token, hash } = newToken();

      const login = await service.loginWithLink(token, request, FRESH_BROWSER);

      expect(login.child).toEqual({ id: CHILD_ID, nickname: '小米' });
      expect(hasher.verify).toHaveBeenCalledWith('secret1', HASH);
      expect(links.take).toHaveBeenCalledExactlyOnceWith(activeLink(hash));
      expect(store.rememberDevice).toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('verifies the password before the transaction, and uses the link last under the lock', async () => {
      await service.loginWithLink(newToken().token, request, FRESH_BROWSER);

      expectCalledInOrder(
        hasher.verify,
        transaction,
        store.lockChild,
        store.rememberDevice,
        links.take,
        committed,
      );
    });

    it('refuses a wrong password with wrong_password and leaves the link unused', async () => {
      hasher.verify.mockResolvedValue(false);

      await expectRefusal(
        service.loginWithLink(newToken().token, request, FRESH_BROWSER),
        'wrong_password',
      );
      expect(transaction).not.toHaveBeenCalled();
      expect(links.take).not.toHaveBeenCalled();
    });

    it('refuses a child without a password with password_not_set', async () => {
      store.findCandidate.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);

      await expectRefusal(
        service.loginWithLink(newToken().token, request, FRESH_BROWSER),
        'password_not_set',
      );
      expect(hasher.verify).not.toHaveBeenCalled();
    });

    it.each<[string, LoginCandidate, ErrorCode]>([
      ['reset', XIAOMI_WITHOUT_PASSWORD, 'password_not_set'],
      ['changed', { ...XIAOMI, passwordHash: OTHER_HASH }, 'wrong_password'],
    ])(
      'refuses a password %s after it was verified with %s, leaving the link unused',
      async (_case, locked, code) => {
        store.lockChild.mockResolvedValue(locked);

        await expectRefusal(service.loginWithLink(newToken().token, request, FRESH_BROWSER), code);
        expect(links.take).not.toHaveBeenCalled();
        expect(store.rememberDevice).not.toHaveBeenCalled();
      },
    );

    it.each(unusableLinks)('answers %s with link_invalid', async (_case, arrange) => {
      arrange();

      await expectRefusal(
        service.loginWithLink(newToken().token, request, FRESH_BROWSER),
        'link_invalid',
      );
      expect(hasher.verify).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each(linksLostUnderLock)(
      'answers a link %s with link_invalid, its writes not committed',
      async (_case, arrange) => {
        arrange();

        await expectRefusal(
          service.loginWithLink(newToken().token, request, FRESH_BROWSER),
          'link_invalid',
        );
        expect(committed).not.toHaveBeenCalled();
      },
    );

    it('fails without committing when Redis fails as it takes the link', async () => {
      const failure = new Error('Redis is not reachable');
      links.take.mockRejectedValue(failure);

      await expect(service.loginWithLink(newToken().token, request, FRESH_BROWSER)).rejects.toBe(
        failure,
      );
      expect(committed).not.toHaveBeenCalled();
    });
  });
});
