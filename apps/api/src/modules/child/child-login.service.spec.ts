import type { ErrorCode } from '@thinklet/contracts';
import type { PasswordHasher } from '../../infrastructure/passwords/password-hasher.js';
import type { FamiliesService } from '../family/families.service.js';
import type {
  ChildLoginRepository,
  ChildLoginStore,
  LinkRecord,
  LoginCandidate,
} from './child-login.repository.js';
import { ChildLoginService, type Browser } from './child-login.service.js';
import { DEVICE_LIFETIME_MS } from './device-cookie.js';
import { hashToken, isWellFormedToken, newToken } from './tokens.js';

const NOW = new Date('2026-11-22T09:00:00.000Z');
/** The clock once a transaction has committed, so a time taken after the commit shows. */
const AFTER_COMMIT = new Date(NOW.getTime() + 1500);
const FAMILY_ID = '5d1e6f70-8192-4a3b-8c4d-5e6f708192a3';
const OTHER_FAMILY_ID = '8a40b1c2-d3e4-4f5a-8b6c-7d8e9f0a1b2c';
const CHILD_ID = '3f9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const SIBLING_ID = '41f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
const COUSIN_ID = 'c3d9e0f1-a2b3-4c4d-9e5f-6a7b8c9d0e1f';
const LINK_ID = '7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d';
const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhcw';
const OTHER_HASH = '$argon2id$v=19$m=19456,t=2,p=1$b3RoZXJzYWx0$b3RoZXItaGFzaA';
const STAND_IN = '$argon2id$v=19$m=19456,t=2,p=1$c3RhbmRpbg$c3RhbmQtaW4';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const LOGIN = { code: '7KQ4MZ', account: 'xiaomi', password: 'secret1', remember: false };
const XIAOMI: LoginCandidate = { id: CHILD_ID, nickname: '小米', passwordHash: HASH };
const XIAOMI_WITHOUT_PASSWORD: LoginCandidate = { ...XIAOMI, passwordHash: null };
const FRESH_BROWSER: Browser = { deviceToken: undefined, userAgent: IPAD };

const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

/** A login link of Xiaomi, active unless the changes say otherwise. */
const linkOf = (changes: Partial<LinkRecord> = {}): LinkRecord => ({
  linkId: LINK_ID,
  childId: CHILD_ID,
  nickname: '小米',
  passwordHash: HASH,
  expiresAt: minutesFromNow(5),
  usedAt: null,
  revokedAt: null,
  ...changes,
});

/** Asserts that the call is refused with the api error of the code. */
const expectRefusal = (call: Promise<unknown>, code: ErrorCode) =>
  expect(call).rejects.toMatchObject({ code });

/** Asserts that every mock was called, each first called after the one before it. */
function expectCalledInOrder(...mocks: Array<{ mock: { invocationCallOrder: number[] } }>): void {
  const firstCalls = mocks.map((mock) => mock.mock.invocationCallOrder[0] ?? Number.NaN);
  expect(firstCalls.every(Number.isFinite)).toBe(true);
  expect(firstCalls).toEqual([...firstCalls].sort((a, b) => a - b));
}

describe('ChildLoginService', () => {
  const store = {
    findLoginCandidate: vi.fn<ChildLoginStore['findLoginCandidate']>(),
    lockChild: vi.fn<ChildLoginStore['lockChild']>(),
    findLinkByToken: vi.fn<ChildLoginStore['findLinkByToken']>(),
    lockLink: vi.fn<ChildLoginStore['lockLink']>(),
    setPassword: vi.fn<ChildLoginStore['setPassword']>(),
    markLinkUsed: vi.fn<ChildLoginStore['markLinkUsed']>(),
    rememberDevice: vi.fn<ChildLoginStore['rememberDevice']>(),
    renewDevice: vi.fn<ChildLoginStore['renewDevice']>(),
    forgetDevice: vi.fn<ChildLoginStore['forgetDevice']>(),
    listRemembered: vi.fn<ChildLoginStore['listRemembered']>(),
  };
  /** Called once a transaction's work has resolved; it moves the clock on, as time passes after a commit. */
  const committed = vi.fn<() => void>();
  const transaction = vi.fn(async (work: (s: ChildLoginStore) => Promise<unknown>) => {
    const result = await work(store as unknown as ChildLoginStore);
    committed();
    return result;
  });
  const repository = { ...store, transaction } as unknown as ChildLoginRepository;
  const families = {
    findIdByCode: vi.fn<FamiliesService['findIdByCode']>(),
    codesOf: vi.fn<FamiliesService['codesOf']>(),
  };
  const hasher = {
    hash: vi.fn<PasswordHasher['hash']>(),
    verify: vi.fn<PasswordHasher['verify']>(),
  };
  let service: ChildLoginService;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const mock of [...Object.values(store), ...Object.values(families)]) {
      mock.mockReset();
    }
    transaction.mockClear();
    committed.mockReset().mockImplementation(() => {
      vi.setSystemTime(AFTER_COMMIT);
    });
    hasher.hash.mockReset().mockResolvedValue(STAND_IN);
    hasher.verify.mockReset().mockResolvedValue(false);
    families.findIdByCode.mockResolvedValue(FAMILY_ID);
    store.findLoginCandidate.mockResolvedValue(XIAOMI);
    store.lockChild.mockResolvedValue(XIAOMI);
    service = new ChildLoginService(repository, families as unknown as FamiliesService, hasher);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('login', () => {
    it("logs the child in with the family's code, the account and the right password", async () => {
      hasher.verify.mockResolvedValue(true);

      const login = await service.login(LOGIN, FRESH_BROWSER);

      expect(login).toEqual({
        child: { id: CHILD_ID, nickname: '小米' },
        deviceToken: undefined,
        issuedAt: NOW,
      });
      expect(families.findIdByCode).toHaveBeenCalledWith('7KQ4MZ');
      expect(store.findLoginCandidate).toHaveBeenCalledWith(FAMILY_ID, 'xiaomi');
      expect(hasher.verify).toHaveBeenCalledWith('secret1', HASH);
      expect(store.lockChild).toHaveBeenCalledWith(CHILD_ID);
    });

    it("verifies the password before the transaction, then writes the device and takes the session's issue time under the child's lock", async () => {
      hasher.verify.mockResolvedValue(true);

      const login = await service.login({ ...LOGIN, remember: true }, FRESH_BROWSER);

      expectCalledInOrder(
        hasher.verify,
        transaction,
        store.lockChild,
        store.rememberDevice,
        committed,
      );
      expect(login.issuedAt).toEqual(NOW);
    });

    it.each<[string, () => void]>([
      ['a code no family has', () => families.findIdByCode.mockResolvedValue(undefined)],
      [
        'an account the family does not have',
        () => store.findLoginCandidate.mockResolvedValue(undefined),
      ],
      [
        'a child without a password yet',
        () => store.findLoginCandidate.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD),
      ],
    ])(
      'refuses %s with login_failed, checking the password against the stand-in hash',
      async (_case, arrange) => {
        arrange();
        hasher.verify.mockResolvedValue(true);

        await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');
        expect(hasher.verify).toHaveBeenCalledTimes(1);
        expect(hasher.verify).toHaveBeenCalledWith('secret1', STAND_IN);
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it('refuses a wrong password with the same login_failed', async () => {
      await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');
      expect(hasher.verify).toHaveBeenCalledWith('secret1', HASH);
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
          service.login({ ...LOGIN, remember: true }, FRESH_BROWSER),
          'login_failed',
        );
        expect(store.rememberDevice).not.toHaveBeenCalled();
      },
    );

    it('makes the stand-in hash once, with the cost of every new hash', async () => {
      families.findIdByCode.mockResolvedValue(undefined);

      await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');
      await expectRefusal(service.login(LOGIN, FRESH_BROWSER), 'login_failed');

      expect(hasher.hash).toHaveBeenCalledTimes(1);
      expect(hasher.verify).toHaveBeenCalledTimes(2);
    });
  });

  describe('remembering the browser on a login', () => {
    beforeEach(() => {
      hasher.verify.mockResolvedValue(true);
    });

    it('gives a browser without a device token a new one and remembers the child for 30 days', async () => {
      const login = await service.login({ ...LOGIN, remember: true }, FRESH_BROWSER);

      expect(isWellFormedToken(login.deviceToken)).toBe(true);
      expect(store.rememberDevice).toHaveBeenCalledWith({
        childId: CHILD_ID,
        tokenHash: hashToken(login.deviceToken ?? ''),
        name: 'iPad · Safari',
        now: NOW,
        expiresAt: new Date(NOW.getTime() + DEVICE_LIFETIME_MS),
      });
    });

    it("keeps the browser's own device token, shared with the other children it remembers", async () => {
      const { token, hash } = newToken();

      const login = await service.login(
        { ...LOGIN, remember: true },
        { deviceToken: token, userAgent: undefined },
      );

      expect(login.deviceToken).toBe(token);
      expect(store.rememberDevice).toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: hash, name: '未知设备' }),
      );
    });

    it('forgets the child on the browser when not remembered, and leaves its cookie', async () => {
      const { token, hash } = newToken();

      const login = await service.login(LOGIN, { deviceToken: token, userAgent: IPAD });

      expect(login.deviceToken).toBeUndefined();
      expect(store.forgetDevice).toHaveBeenCalledWith(CHILD_ID, hash);
      expect(store.rememberDevice).not.toHaveBeenCalled();
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
        { childId: COUSIN_ID, familyId: OTHER_FAMILY_ID, nickname: '大米', account: 'dami' },
        { childId: SIBLING_ID, familyId: FAMILY_ID, nickname: '米粒', account: 'mili' },
      ]);
      families.codesOf.mockResolvedValue(
        new Map([
          [FAMILY_ID, '7KQ4MZ'],
          [OTHER_FAMILY_ID, 'P2X9WD'],
        ]),
      );

      const remembered = await service.remembered(token);

      expect(store.listRemembered).toHaveBeenCalledWith(hash, NOW);
      expect(families.codesOf).toHaveBeenCalledWith([FAMILY_ID, OTHER_FAMILY_ID]);
      expect(remembered).toEqual([
        { childId: CHILD_ID, nickname: '小米', familyCode: '7KQ4MZ', account: 'xiaomi' },
        { childId: COUSIN_ID, nickname: '大米', familyCode: 'P2X9WD', account: 'dami' },
        { childId: SIBLING_ID, nickname: '米粒', familyCode: '7KQ4MZ', account: 'mili' },
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
        issuedAt: NOW,
      });
      expect(store.lockChild).toHaveBeenCalledWith(CHILD_ID);
      expect(store.renewDevice).toHaveBeenCalledWith(
        CHILD_ID,
        hash,
        NOW,
        new Date(NOW.getTime() + DEVICE_LIFETIME_MS),
      );
      expectCalledInOrder(transaction, store.lockChild, store.renewDevice, committed);
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

  /** The ways a link cannot be used, each answered as link_invalid. */
  const unusableLinks: Array<[string, LinkRecord | undefined]> = [
    ['an unknown link, or one of a deleted child', undefined],
    ['a used link', linkOf({ usedAt: minutesFromNow(-1) })],
    ['a revoked link', linkOf({ revokedAt: minutesFromNow(-1) })],
    ['an expired link', linkOf({ expiresAt: NOW })],
  ];

  describe('linkInfo', () => {
    it('tells whose link it is and whether the child still has to set a password', async () => {
      const { token, hash } = newToken();
      store.findLinkByToken
        .mockResolvedValueOnce(linkOf())
        .mockResolvedValueOnce(linkOf({ passwordHash: null }));

      const withPassword = await service.linkInfo(token);
      const withoutPassword = await service.linkInfo(token);

      expect(store.findLinkByToken).toHaveBeenCalledWith(hash);
      expect(withPassword).toEqual({ childId: CHILD_ID, nickname: '小米', needsPassword: false });
      expect(withoutPassword).toEqual({ childId: CHILD_ID, nickname: '小米', needsPassword: true });
      expect(store.markLinkUsed).not.toHaveBeenCalled();
    });

    it.each(unusableLinks)('answers %s with link_invalid', async (_case, link) => {
      store.findLinkByToken.mockResolvedValue(link);

      await expectRefusal(service.linkInfo(newToken().token), 'link_invalid');
    });
  });

  describe('setPasswordWithLink', () => {
    const request = { password: 'new secret', remember: true };

    beforeEach(() => {
      store.findLinkByToken.mockResolvedValue(linkOf({ passwordHash: null }));
      store.lockLink.mockResolvedValue(linkOf({ passwordHash: null }));
      store.lockChild.mockResolvedValue(XIAOMI_WITHOUT_PASSWORD);
      hasher.hash.mockResolvedValue(HASH);
    });

    it("sets the child's first password, uses the link and logs the child in", async () => {
      const { token, hash } = newToken();

      const login = await service.setPasswordWithLink(token, request, FRESH_BROWSER);

      expect(login.child).toEqual({ id: CHILD_ID, nickname: '小米' });
      expect(store.findLinkByToken).toHaveBeenCalledWith(hash);
      expect(store.lockChild).toHaveBeenCalledWith(CHILD_ID);
      expect(store.lockLink).toHaveBeenCalledWith(CHILD_ID, hash);
      expect(hasher.hash).toHaveBeenCalledWith('new secret');
      expect(store.setPassword).toHaveBeenCalledWith(CHILD_ID, HASH);
      expect(store.markLinkUsed).toHaveBeenCalledWith(LINK_ID, NOW);
    });

    it('hashes the password before the transaction, and locks the child before the link', async () => {
      const login = await service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER);

      expectCalledInOrder(
        hasher.hash,
        transaction,
        store.lockChild,
        store.lockLink,
        store.setPassword,
        store.markLinkUsed,
        store.rememberDevice,
        committed,
      );
      expect(login.issuedAt).toEqual(NOW);
    });

    it('refuses a child who has a password with password_already_set, hashing nothing', async () => {
      store.findLinkByToken.mockResolvedValue(linkOf());

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'password_already_set',
      );
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('refuses with password_already_set a password set under the lock first, changing nothing', async () => {
      store.lockChild.mockResolvedValue(XIAOMI);

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'password_already_set',
      );
      expect(store.setPassword).not.toHaveBeenCalled();
      expect(store.markLinkUsed).not.toHaveBeenCalled();
      expect(store.rememberDevice).not.toHaveBeenCalled();
    });

    it.each(unusableLinks)('answers %s with link_invalid, hashing nothing', async (_case, link) => {
      store.findLinkByToken.mockResolvedValue(
        link === undefined ? undefined : { ...link, passwordHash: null },
      );

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'link_invalid',
      );
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each(unusableLinks)(
      'answers %s by the time it is locked with link_invalid, setting nothing',
      async (_case, link) => {
        store.lockLink.mockResolvedValue(link);

        await expectRefusal(
          service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
          'link_invalid',
        );
        expect(store.setPassword).not.toHaveBeenCalled();
        expect(store.markLinkUsed).not.toHaveBeenCalled();
      },
    );

    it('answers a child deleted by then with link_invalid', async () => {
      store.lockChild.mockResolvedValue(undefined);

      await expectRefusal(
        service.setPasswordWithLink(newToken().token, request, FRESH_BROWSER),
        'link_invalid',
      );
      expect(store.lockLink).not.toHaveBeenCalled();
    });
  });

  describe('loginWithLink', () => {
    const request = { password: 'secret1', remember: true };

    beforeEach(() => {
      store.findLinkByToken.mockResolvedValue(linkOf());
      store.lockLink.mockResolvedValue(linkOf());
      hasher.verify.mockResolvedValue(true);
    });

    it('logs the child in with the right password and uses the link', async () => {
      const login = await service.loginWithLink(newToken().token, request, FRESH_BROWSER);

      expect(login.child).toEqual({ id: CHILD_ID, nickname: '小米' });
      expect(hasher.verify).toHaveBeenCalledWith('secret1', HASH);
      expect(store.markLinkUsed).toHaveBeenCalledWith(LINK_ID, NOW);
      expect(store.rememberDevice).toHaveBeenCalled();
    });

    it('verifies the password before the transaction, and locks the child before the link', async () => {
      const login = await service.loginWithLink(newToken().token, request, FRESH_BROWSER);

      expectCalledInOrder(
        hasher.verify,
        transaction,
        store.lockChild,
        store.lockLink,
        store.markLinkUsed,
        store.rememberDevice,
        committed,
      );
      expect(login.issuedAt).toEqual(NOW);
    });

    it('refuses a wrong password with wrong_password and leaves the link unused', async () => {
      hasher.verify.mockResolvedValue(false);

      await expectRefusal(
        service.loginWithLink(newToken().token, request, FRESH_BROWSER),
        'wrong_password',
      );
      expect(transaction).not.toHaveBeenCalled();
      expect(store.markLinkUsed).not.toHaveBeenCalled();
    });

    it('refuses a child without a password with password_not_set', async () => {
      store.findLinkByToken.mockResolvedValue(linkOf({ passwordHash: null }));

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
        expect(store.markLinkUsed).not.toHaveBeenCalled();
        expect(store.rememberDevice).not.toHaveBeenCalled();
      },
    );

    it.each(unusableLinks)('answers %s with link_invalid', async (_case, link) => {
      store.findLinkByToken.mockResolvedValue(link);

      await expectRefusal(
        service.loginWithLink(newToken().token, request, FRESH_BROWSER),
        'link_invalid',
      );
      expect(hasher.verify).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each(unusableLinks)(
      'answers %s by the time it is locked with link_invalid',
      async (_case, link) => {
        store.lockLink.mockResolvedValue(link);

        await expectRefusal(
          service.loginWithLink(newToken().token, request, FRESH_BROWSER),
          'link_invalid',
        );
        expect(store.markLinkUsed).not.toHaveBeenCalled();
      },
    );
  });
});
