import { createHash } from 'node:crypto';
import {
  childLoginLinkStatusResponseSchema,
  errorResponseSchema,
  familyDetailSchema,
  rememberedChildListSchema,
  type Child,
  type FamilyDetail,
} from '@thinklet/contracts';
import { decodeJwt } from 'jose';
import type request from 'supertest';
import {
  CHILD_SESSION_COOKIE,
  ChildBrowser,
  DEVICE_COOKIE,
  addChildWithPassword,
  linkPath,
  newLoginLink,
  type ChildWithPassword,
} from '../support/child-login.js';
import {
  addChild,
  childPath,
  childRow,
  decryptedDeviceName,
  deviceRows,
  endPasswordSetup,
  insertDevice,
  type DeviceRow,
} from '../support/children.js';
import { query } from '../support/database.js';
import {
  as,
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { expireLoginLink } from '../support/login-links.js';
import { expectCleared, expectLoginCookieAttributes, setCookiesOf } from '../support/login.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE = String(7 * 24 * 60 * 60);
const DEVICE_MAX_AGE = String(30 * 24 * 60 * 60);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** How many times a test of two requests at the same time sends them, to meet their interleavings. */
const RACE_ROUNDS = 20;

/** How far another api instance's clock is off the database's in the clock tests: several seconds. */
const SKEW_MS = 8_000;

/** A child's login ready to send, on the browser it signs in. */
interface PendingLogin {
  child: Child;
  kid: ChildBrowser;
  send: () => Promise<request.Response>;
}

/** A use of a child's login link: the route under the link and the body to send it. */
interface LinkUse {
  child: Child;
  route: 'login' | 'password';
  body: { password: string; remember: boolean };
}

/** The devices given to a child directly in the database: two expired and one still valid. */
interface PlantedDevices {
  valid: string;
  expired: string[];
}

/** The error code of an error response, whose body has nothing else but the request id. */
function errorCodeOf(response: request.Response): string {
  const { error } = errorResponseSchema.parse(response.body);
  expect(Object.keys(error).sort()).toEqual(['code', 'requestId']);
  return error.code;
}

/** Asserts a login that signed the child in for 7 days and answered who it is. */
function expectSignedIn(response: request.Response, child: Child): void {
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ id: child.id, nickname: child.nickname });
  const session = setCookiesOf(response)[CHILD_SESSION_COOKIE];
  expectLoginCookieAttributes(session);
  expect(session?.attributes['max-age']).toBe(SESSION_MAX_AGE);
}

/** How long a device row lasts from its last login. */
const lifetimeOf = (row: DeviceRow) => row.expires_at.getTime() - row.last_used_at.getTime();

/** The time the given number of days ago. */
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/**
 * Runs the work with this process's clock, and so the api's, off the
 * database's by `offsetMs`, as on another api instance whose clock is
 * ahead (positive) or behind (negative). Only Date is faked; it moves on.
 */
async function onInstanceOff<T>(offsetMs: number, work: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true, now: Date.now() + offsetMs });
  try {
    return await work();
  } finally {
    vi.useRealTimers();
  }
}

/** The issue time of the child login the browser holds, in milliseconds. */
function issuedAtOf(kid: ChildBrowser): number {
  return (decodeJwt(kid.cookies.get(CHILD_SESSION_COOKIE) ?? '').iat ?? Number.NaN) * 1000;
}

// Acceptance criteria covered: a child logs in with the family code, the
// account and the password, and any wrong item, or a child without a
// password whose time to set one with the account has run out, is
// "家庭码、账号或密码不对" (#14, 25); remembering a browser shows the
// child's avatar there for 30 days from the last avatar login, and not
// remembering forgets it; a revoked or expired device needs the password
// again; a device token is kept only when the database has a valid device
// with it (#14, 18); a child's login and a password reset take their times
// from the database, so api instances whose clocks are off by seconds
// neither end a fresh login nor keep one issued before a reset (#14, 20);
// every login deletes the child's expired devices and no other child's
// (#14, 23); a login link works for 10 minutes and once, two uses at the
// same time included, and a newer one revokes it (#14, 24); a child
// without a password sets one on the link and is signed in, a child with
// one enters it, and a wrong one keeps the link usable; a password reset
// or the child's deletion ends the child's login at the next request;
// logging out keeps the avatar; a device's name is stored encrypted for
// its own row. Setting the first password with the account is in
// child-first-password.spec.ts.
describe('child login', () => {
  const running = useAppWithServices();
  let parent: Parent;
  let family: FamilyDetail;

  const browser = () => new ChildBrowser(running.server);
  const withPassword = () => addChildWithPassword(running.server, parent, family.id);
  const newChild = (nickname?: string) =>
    addChild(running.server, parent, family.id, nickname === undefined ? {} : { nickname });
  const loginOf = (child: ChildWithPassword, remember = false) => ({
    code: family.code,
    account: child.account,
    password: child.password,
    remember,
  });
  const loginWithout = (child: Child) => ({
    code: family.code,
    account: child.account,
    remember: false,
  });
  const linkOf = (child: Child) => newLoginLink(running.server, parent, family.id, child.id);
  const newerLink = (child: Child) =>
    as(running.server, parent).post(`${childPath(family.id, child.id)}/login-links`);
  const resetPassword = (child: Child) =>
    as(running.server, parent).post(`${childPath(family.id, child.id)}/password-reset`);
  const linkStatus = async (child: Child, linkId: string) =>
    childLoginLinkStatusResponseSchema.parse(
      (
        await as(running.server, parent)
          .get(`${childPath(family.id, child.id)}/login-links/${linkId}`)
          .expect(200)
      ).body,
    ).status;
  const devicesOf = (childId: string) => deviceRows(running.databaseUrl, childId);
  const deviceIdsOf = async (childId: string) =>
    (await devicesOf(childId)).map((row) => row.id).sort();
  const updateDevices = (childId: string, set: string) =>
    query(running.databaseUrl, `update child_devices set ${set} where child_id = $1`, [childId]);
  const expireDevices = (childId: string) => updateDevices(childId, 'expires_at = now()');
  const setPasswordOnLink = (kid: ChildBrowser, token: string) =>
    kid.post(`${linkPath(token)}/password`, { password: 'my secret', remember: false });

  /** The database's clock now. */
  async function databaseNow(): Promise<Date> {
    const [row] = await query<{ now: Date }>(
      running.databaseUrl,
      'select clock_timestamp() as now',
    );
    if (row === undefined) {
      throw new Error('The database did not answer its time');
    }
    return row.now;
  }

  /**
   * Waits until the database's clock reaches the time before which the
   * child's logins are refused: a reset refuses the rest of its own second
   * as well.
   */
  async function untilLoginsCount(childId: string): Promise<void> {
    const validAfter = (await childRow(running.databaseUrl, childId))?.sessions_valid_after;
    if (validAfter === undefined) {
      throw new Error('The child is gone');
    }
    await vi.waitUntil(async () => (await databaseNow()).getTime() >= validAfter.getTime(), {
      timeout: 3_000,
      interval: 100,
    });
  }

  /** The child's one device row; fails when the child has none or more. */
  async function onlyDevice(childId: string): Promise<DeviceRow> {
    const rows = await devicesOf(childId);
    const [row] = rows;
    if (rows.length !== 1 || row === undefined) {
      throw new Error(`The child has ${rows.length} devices`);
    }
    return row;
  }

  /** New children with passwords, each logged in on one browser that remembers them all. */
  async function rememberedOnOneBrowser(
    count: number,
  ): Promise<{ children: ChildWithPassword[]; kid: ChildBrowser }> {
    const kid = browser();
    const children: ChildWithPassword[] = [];
    for (let i = 0; i < count; i += 1) {
      const child = await withPassword();
      expect((await kid.login(loginOf(child, true))).status).toBe(200);
      children.push(child);
    }
    return { children, kid };
  }

  /** A new child remembered on a browser, which is signed in as the child. */
  async function rememberedChild(): Promise<{ child: ChildWithPassword; kid: ChildBrowser }> {
    const {
      children: [child],
      kid,
    } = await rememberedOnOneBrowser(1);
    if (child === undefined) {
      throw new Error('No child was remembered');
    }
    return { child, kid };
  }

  /** Gives the child two devices that expired days ago and one still valid, on browsers of their own. */
  async function plantDevices(childId: string): Promise<PlantedDevices> {
    const expired = [
      await insertDevice(running.databaseUrl, childId, {
        name: 'Windows 电脑 · Edge',
        rememberedAt: daysAgo(60),
        lastUsedAt: daysAgo(31),
      }),
      await insertDevice(running.databaseUrl, childId, {
        name: 'Android 手机 · Chrome',
        rememberedAt: daysAgo(90),
        lastUsedAt: daysAgo(45),
      }),
    ];
    const valid = await insertDevice(running.databaseUrl, childId, {
      name: 'iPad · Safari',
      rememberedAt: daysAgo(20),
      lastUsedAt: daysAgo(2),
    });
    return { valid, expired };
  }

  /**
   * Sends a login and a password reset of its child at the same time, for
   * a new login each round. Whichever runs first, the reset wins: the login
   * is refused, or it ends at the next request and its device is forgotten.
   */
  async function expectResetWinsOver(prepare: () => Promise<PendingLogin>): Promise<void> {
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const { child, kid, send } = await prepare();

      const [login, reset] = await Promise.all([send(), resetPassword(child)]);

      expect(reset.status).toBe(204);
      expect([200, 401]).toContain(login.status);
      expect((await kid.me()).status).toBe(401);
      expect(await devicesOf(child.id)).toEqual([]);
    }
  }

  beforeAll(async () => {
    parent = await signInParent(running.server, { name: '林悦' });
    family = await createFamily(running.server, parent);
  });

  describe('POST /api/child-auth/login', () => {
    it('signs the child in for 7 days and answers who it is', async () => {
      const child = await withPassword();
      const kid = browser();

      const response = await kid.login(loginOf(child));

      expectSignedIn(response, child);
      expect(setCookiesOf(response)['thinklet_session']).toBeUndefined();
      expect((await kid.me()).body).toEqual({ id: child.id, nickname: child.nickname });
    });

    it('takes the family code in any case', async () => {
      const child = await withPassword();

      const response = await browser().login({
        ...loginOf(child),
        code: family.code.toLowerCase(),
      });

      expect(response.status).toBe(200);
    });

    it('signs in the new child in place of the one signed in on the browser', async () => {
      const first = await withPassword();
      const second = await withPassword();
      const kid = browser();
      expect((await kid.login(loginOf(first))).status).toBe(200);

      expect((await kid.login(loginOf(second))).status).toBe(200);

      expect((await kid.me()).body).toMatchObject({ id: second.id });
    });

    it('answers every wrong item, a missing password and a child whose time to set one has run out with login_failed and no login', async () => {
      const child = await withPassword();
      const other = await createFamily(running.server, parent);
      const noPassword = await newChild();
      await endPasswordSetup(running.databaseUrl, noPassword.id);
      const unused = ['ZZZZZZ', 'YYYYYY'].find(
        (code) => code !== family.code && code !== other.code,
      );
      const login = loginOf(child);

      const responses = await Promise.all(
        [
          { ...login, code: other.code },
          { ...login, code: unused ?? '' },
          { ...login, account: `${child.account}x` },
          { ...login, password: `${child.password}x` },
          loginWithout(child),
          { ...login, account: noPassword.account, password: 'anything' },
          loginWithout(noPassword),
        ].map((body) => browser().login(body)),
      );

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(errorCodeOf(response)).toBe('login_failed');
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('is refused, or ends with its remembered device, when a parent resets the password at the same time', async () => {
      await expectResetWinsOver(async () => {
        const child = await withPassword();
        const kid = browser();
        return { child, kid, send: () => kid.login(loginOf(child, true)) };
      });
    });
  });

  describe('remembering the browser', () => {
    it('remembers the child for 30 days under a new device token, the device named and encrypted for its row', async () => {
      const child = await withPassword();
      const before = Date.now();

      const response = await browser().login(loginOf(child, true));

      const device = setCookiesOf(response)[DEVICE_COOKIE];
      expectLoginCookieAttributes(device);
      expect(device?.attributes['max-age']).toBe(DEVICE_MAX_AGE);
      const token = device?.value ?? '';
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      const row = await onlyDevice(child.id);
      expect(row.token_hash).toBe(sha256(token));
      expect(row.name).not.toContain('iPad');
      expect(decryptedDeviceName(row)).toBe('iPad · Safari');
      expect(row.remembered_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.last_used_at).toEqual(row.remembered_at);
      expect(lifetimeOf(row)).toBe(30 * DAY_MS);
    });

    it('renews the same row and token on a later remembered login, keeping when it was remembered and its name', async () => {
      const { child, kid } = await rememberedChild();
      const first = await onlyDevice(child.id);
      const token = kid.cookies.get(DEVICE_COOKIE);

      const response = await kid.login(loginOf(child, true));

      expect(setCookiesOf(response)[DEVICE_COOKIE]?.value).toBe(token);
      const renewed = await onlyDevice(child.id);
      expect(renewed.id).toBe(first.id);
      expect(renewed.name).toBe(first.name);
      expect(renewed.remembered_at).toEqual(first.remembered_at);
      expect(renewed.last_used_at.getTime()).toBeGreaterThan(first.last_used_at.getTime());
    });

    it('remembers the browser anew under a new token once its only device has expired, as a new row whose name is encrypted for it', async () => {
      const { child, kid } = await rememberedChild();
      await updateDevices(
        child.id,
        "remembered_at = now() - interval '40 days', expires_at = now() - interval '1 day'",
      );
      const expired = await onlyDevice(child.id);
      const oldToken = kid.cookies.get(DEVICE_COOKIE) ?? '';

      const response = await kid.login(loginOf(child, true));

      const newToken = setCookiesOf(response)[DEVICE_COOKIE]?.value ?? '';
      expect(Buffer.from(newToken, 'base64url')).toHaveLength(32);
      expect(newToken).not.toBe(oldToken);
      const row = await onlyDevice(child.id);
      expect(row.id).not.toBe(expired.id);
      expect(row.token_hash).toBe(sha256(newToken));
      expect(decryptedDeviceName(row)).toBe('iPad · Safari');
      expect(row.remembered_at).toEqual(row.last_used_at);
      expect(lifetimeOf(row)).toBe(30 * DAY_MS);
    });

    it("keeps the device token another child's valid device has, though this child's has expired", async () => {
      const {
        children: [first, second],
        kid,
      } = await rememberedOnOneBrowser(2);
      if (first === undefined || second === undefined) {
        throw new Error('The children were not remembered');
      }
      const token = kid.cookies.get(DEVICE_COOKIE) ?? '';
      const expired = await onlyDevice(first.id);
      await expireDevices(first.id);

      const response = await kid.login(loginOf(first, true));

      expect(setCookiesOf(response)[DEVICE_COOKIE]?.value).toBe(token);
      const row = await onlyDevice(first.id);
      expect(row.id).not.toBe(expired.id);
      expect(row.token_hash).toBe(sha256(token));
      expect((await onlyDevice(second.id)).token_hash).toBe(sha256(token));
    });

    it('shares one device token among the children the browser remembers', async () => {
      const { children, kid } = await rememberedOnOneBrowser(2);

      const tokenHash = sha256(kid.cookies.get(DEVICE_COOKIE) ?? '');
      for (const child of children) {
        expect((await onlyDevice(child.id)).token_hash).toBe(tokenHash);
      }
    });

    it('forgets the child on the browser when not remembered, keeping the device cookie', async () => {
      const { child, kid } = await rememberedChild();

      const response = await kid.login(loginOf(child, false));

      expect(response.status).toBe(200);
      expect(setCookiesOf(response)[DEVICE_COOKIE]).toBeUndefined();
      expect(kid.cookies.has(DEVICE_COOKIE)).toBe(true);
      expect(await devicesOf(child.id)).toEqual([]);
    });

    it('sets no device cookie on a login that is not remembered', async () => {
      const child = await withPassword();

      const response = await browser().login(loginOf(child));

      expect(setCookiesOf(response)[DEVICE_COOKIE]).toBeUndefined();
      expect(await devicesOf(child.id)).toEqual([]);
    });
  });

  describe('expired devices', () => {
    it.each<[string, () => Promise<{ child: Child; send: () => Promise<request.Response> }>]>([
      [
        'with the account and the password',
        async () => {
          const child = await withPassword();
          return { child, send: () => browser().login(loginOf(child)) };
        },
      ],
      [
        'setting the first password with the account',
        async () => {
          const child = await newChild();
          return {
            child,
            send: () =>
              browser().setFirstPassword({
                code: family.code,
                account: child.account,
                password: 'my secret',
                remember: false,
              }),
          };
        },
      ],
      [
        'by the avatar',
        async () => {
          const { child, kid } = await rememberedChild();
          kid.cookies.delete(CHILD_SESSION_COOKIE);
          return { child, send: () => kid.loginRemembered(child.id) };
        },
      ],
      [
        'setting the first password on a link',
        async () => {
          const child = await newChild();
          const { token } = await linkOf(child);
          return { child, send: () => setPasswordOnLink(browser(), token) };
        },
      ],
      [
        'with the password on a link',
        async () => {
          const child = await withPassword();
          const { token } = await linkOf(child);
          return {
            child,
            send: () =>
              browser().post(`${linkPath(token)}/login`, {
                password: child.password,
                remember: false,
              }),
          };
        },
      ],
    ])(
      "are deleted for the child on a login %s, leaving its valid ones and other children's",
      async (_case, prepare) => {
        const { child, send } = await prepare();
        const other = await newChild();
        const planted = await plantDevices(child.id);
        await plantDevices(other.id);
        const before = await deviceIdsOf(child.id);
        const othersBefore = await deviceIdsOf(other.id);

        expect((await send()).status).toBe(200);

        const kept = await deviceIdsOf(child.id);
        expect(kept).toEqual(before.filter((id) => !planted.expired.includes(id)));
        expect(kept).toContain(planted.valid);
        const now = await databaseNow();
        for (const row of await devicesOf(child.id)) {
          expect(row.expires_at.getTime()).toBeGreaterThan(now.getTime());
        }
        expect(await deviceIdsOf(other.id)).toEqual(othersBefore);
      },
    );

    it('stay on a login that fails', async () => {
      const child = await withPassword();
      await plantDevices(child.id);
      const before = await deviceIdsOf(child.id);

      const response = await browser().login({ ...loginOf(child), password: 'not the password' });

      expect(response.status).toBe(401);
      expect(await deviceIdsOf(child.id)).toEqual(before);
    });

    it('leave no audit event behind', async () => {
      const child = await withPassword();
      await plantDevices(child.id);
      const count = async () =>
        (
          await query<{ count: string }>(
            running.databaseUrl,
            'select count(*) from audit_events where target_id = $1',
            [child.id],
          )
        )[0]?.count;
      const before = await count();

      expect((await browser().login(loginOf(child))).status).toBe(200);

      expect(await count()).toBe(before);
    });
  });

  describe("the database's clock", () => {
    it.each<[string, number]>([
      ['ahead of', SKEW_MS],
      ['behind', -SKEW_MS],
    ])(
      "issues a child's login at the database's time on an api instance %s it",
      async (_case, offset) => {
        const child = await withPassword();
        const kid = browser();
        const before = await databaseNow();

        const response = await onInstanceOff(offset, () => kid.login(loginOf(child)));

        const after = await databaseNow();
        expect(response.status).toBe(200);
        expect(issuedAtOf(kid)).toBeGreaterThanOrEqual(Math.floor(before.getTime() / 1000) * 1000);
        expect(issuedAtOf(kid)).toBeLessThanOrEqual(after.getTime());
      },
    );

    it('counts a fresh login on an instance behind the one that added the child', async () => {
      const child = await onInstanceOff(SKEW_MS, () => newChild());
      const { token } = await linkOf(child);
      const kid = browser();

      const response = await onInstanceOff(-SKEW_MS, () => setPasswordOnLink(kid, token));

      expect(response.status).toBe(200);
      expect((await onInstanceOff(-SKEW_MS, () => kid.me())).status).toBe(200);
      expect((await kid.me()).status).toBe(200);
    });

    it('ends a login issued before a reset that an instance behind the issuing one makes', async () => {
      const child = await withPassword();
      const kid = browser();
      await onInstanceOff(SKEW_MS, () => kid.login(loginOf(child)));
      const issuedAt = issuedAtOf(kid);
      expect((await kid.me()).status).toBe(200);

      const reset = await onInstanceOff(-SKEW_MS, () => resetPassword(child));

      expect(reset.status).toBe(204);
      expect((await kid.me()).status).toBe(401);
      expect((await onInstanceOff(SKEW_MS, () => kid.me())).status).toBe(401);
      const validAfter = (await childRow(running.databaseUrl, child.id))?.sessions_valid_after;
      expect((validAfter?.getTime() ?? Number.NaN) % 1000).toBe(0);
      expect(validAfter?.getTime()).toBeGreaterThan(issuedAt);
    });

    it('counts a login after a reset on an instance behind the one that made the reset', async () => {
      const child = await withPassword();
      const { token } = await linkOf(child);
      expect((await onInstanceOff(SKEW_MS, () => resetPassword(child))).status).toBe(204);
      await untilLoginsCount(child.id);
      const kid = browser();

      const response = await onInstanceOff(-SKEW_MS, () => setPasswordOnLink(kid, token));

      expect(response.status).toBe(200);
      expect((await kid.me()).status).toBe(200);
    });
  });

  describe('GET /api/child-auth/remembered', () => {
    it('lists nothing without a device cookie', async () => {
      const response = await browser().get('/api/child-auth/remembered');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it("lists the remembered children in the order remembered, with the family's current code and the account", async () => {
      const { children, kid } = await rememberedOnOneBrowser(2);
      const changed = await as(running.server, parent).post(`/api/families/${family.id}/code`);
      family = familyDetailSchema.parse(changed.body);

      const response = await kid.get('/api/child-auth/remembered');

      expect(rememberedChildListSchema.parse(response.body)).toEqual(
        children.map((child) => ({
          childId: child.id,
          nickname: child.nickname,
          familyCode: family.code,
          account: child.account,
        })),
      );
    });

    it('leaves out an expired device', async () => {
      const { child, kid } = await rememberedChild();
      await expireDevices(child.id);

      expect((await kid.get('/api/child-auth/remembered')).body).toEqual([]);
    });
  });

  describe('POST /api/child-auth/remembered/{childId}/login', () => {
    it('signs the remembered child in without a password and renews the device for 30 days', async () => {
      const { child, kid } = await rememberedChild();
      await updateDevices(
        child.id,
        "last_used_at = now() - interval '20 days', expires_at = now() + interval '10 days'",
      );
      kid.cookies.delete(CHILD_SESSION_COOKIE);
      const before = await onlyDevice(child.id);
      const started = Date.now();

      const response = await kid.loginRemembered(child.id);

      expectSignedIn(response, child);
      const device = setCookiesOf(response)[DEVICE_COOKIE];
      expectLoginCookieAttributes(device);
      expect(device?.value).toBe(kid.cookies.get(DEVICE_COOKIE));
      expect(device?.attributes['max-age']).toBe(DEVICE_MAX_AGE);
      const after = await onlyDevice(child.id);
      expect(after.remembered_at).toEqual(before.remembered_at);
      expect(after.last_used_at.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect(lifetimeOf(after)).toBe(30 * DAY_MS);
      expect((await kid.me()).status).toBe(200);
    });

    it.each<[string, (child: Child) => Promise<unknown>]>([
      [
        'revoked by a parent',
        (child) =>
          as(running.server, parent)
            .delete(`${childPath(family.id, child.id)}/devices`)
            .expect(204),
      ],
      ['expired', (child) => expireDevices(child.id)],
    ])('answers a device %s with remember_invalid and nothing more', async (_case, lose) => {
      const { child, kid } = await rememberedChild();
      kid.cookies.delete(CHILD_SESSION_COOKIE);
      await lose(child);

      const response = await kid.loginRemembered(child.id);

      expect(response.status).toBe(401);
      expect(errorCodeOf(response)).toBe('remember_invalid');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await kid.me()).status).toBe(401);
    });

    it('answers a browser without a device cookie, and an id that is no child id, with remember_invalid', async () => {
      const child = await withPassword();

      const responses = [
        await browser().loginRemembered(child.id),
        await browser().loginRemembered('not-a-child'),
      ];

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(errorCodeOf(response)).toBe('remember_invalid');
      }
    });

    it('is refused, or ends, when a parent resets the password at the same time', async () => {
      await expectResetWinsOver(async () => {
        const { child, kid } = await rememberedChild();
        kid.cookies.delete(CHILD_SESSION_COOKIE);
        return { child, kid, send: () => kid.loginRemembered(child.id) };
      });
    });
  });

  describe('login links', () => {
    it('tells a new child to set a password without using the link', async () => {
      const child = await newChild('阿乐');
      const link = await linkOf(child);

      const response = await browser().get(linkPath(link.token));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ childId: child.id, nickname: '阿乐', needsPassword: true });
      expect(await linkStatus(child, link.id)).toBe('active');
    });

    it('sets the password, uses the link and signs the child in, remembering the browser', async () => {
      const child = await newChild('阿乐');
      const link = await linkOf(child);
      const kid = browser();

      const response = await kid.post(`${linkPath(link.token)}/password`, {
        password: 'my secret',
        remember: true,
      });

      expectSignedIn(response, child);
      expect((await kid.me()).body).toEqual({ id: child.id, nickname: '阿乐' });
      expect((await childRow(running.databaseUrl, child.id))?.password_hash).toMatch(
        /^\$argon2id\$v=19\$/,
      );
      expect(await linkStatus(child, link.id)).toBe('used');
      expect(await devicesOf(child.id)).toHaveLength(1);
      const login = await browser().login(loginOf({ ...child, password: 'my secret' }));
      expect(login.status).toBe(200);
    });

    it('refuses a password of the wrong length with the field, keeping the link', async () => {
      const child = await newChild();
      const link = await linkOf(child);

      const response = await browser().post(`${linkPath(link.token)}/password`, {
        password: '12345',
        remember: false,
      });

      expect(response.status).toBe(400);
      expect(errorResponseSchema.parse(response.body).error).toMatchObject({
        code: 'invalid_request',
        fields: [{ path: 'password', code: 'too_short' }],
      });
      expect(await linkStatus(child, link.id)).toBe('active');
    });

    it('tells a child with a password to enter it, and refuses to set another', async () => {
      const child = await withPassword();
      const link = await linkOf(child);

      const info = await browser().get(linkPath(link.token));
      const setting = await browser().post(`${linkPath(link.token)}/password`, {
        password: 'another one',
        remember: false,
      });

      expect(info.body).toMatchObject({ needsPassword: false });
      expect(setting.status).toBe(409);
      expect(errorCodeOf(setting)).toBe('password_already_set');
      expect(await linkStatus(child, link.id)).toBe('active');
    });

    it('keeps the link usable after a wrong password, and uses it with the right one', async () => {
      const child = await withPassword();
      const link = await linkOf(child);
      const kid = browser();

      const wrong = await kid.post(`${linkPath(link.token)}/login`, {
        password: `${child.password}x`,
        remember: false,
      });
      const right = await kid.post(`${linkPath(link.token)}/login`, {
        password: child.password,
        remember: false,
      });

      expect(wrong.status).toBe(401);
      expect(errorCodeOf(wrong)).toBe('wrong_password');
      expectSignedIn(right, child);
      expect(await linkStatus(child, link.id)).toBe('used');
      expect((await kid.me()).status).toBe(200);
    });

    it('refuses to log in a child without a password with password_not_set', async () => {
      const child = await newChild();
      const link = await linkOf(child);

      const response = await browser().post(`${linkPath(link.token)}/login`, {
        password: 'anything',
        remember: false,
      });

      expect(response.status).toBe(409);
      expect(errorCodeOf(response)).toBe('password_not_set');
    });

    it('works once only: every later use is link_invalid', async () => {
      const child = await newChild();
      const link = await linkOf(child);
      const body = { password: 'my secret', remember: false };
      expect((await browser().post(`${linkPath(link.token)}/password`, body)).status).toBe(200);

      const responses = [
        await browser().get(linkPath(link.token)),
        await browser().post(`${linkPath(link.token)}/password`, body),
        await browser().post(`${linkPath(link.token)}/login`, body),
      ];

      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(errorCodeOf(response)).toBe('link_invalid');
      }
    });

    it.each<[string, () => Promise<LinkUse>]>([
      [
        'logins',
        async () => {
          const child = await withPassword();
          return { child, route: 'login', body: { password: child.password, remember: false } };
        },
      ],
      [
        'first passwords',
        async () => ({
          child: await newChild(),
          route: 'password',
          body: { password: 'my secret', remember: false },
        }),
      ],
    ])(
      'is used by only one of two %s at the same time; the other is link_invalid',
      async (_case, prepare) => {
        for (let round = 0; round < RACE_ROUNDS; round += 1) {
          const { child, route, body } = await prepare();
          const link = await linkOf(child);

          const responses = await Promise.all([
            browser().post(`${linkPath(link.token)}/${route}`, body),
            browser().post(`${linkPath(link.token)}/${route}`, body),
          ]);

          const outcomes = responses.map((response) =>
            response.status === 200 ? 'signed in' : errorCodeOf(response),
          );
          expect(outcomes.sort()).toEqual(['link_invalid', 'signed in']);
          expect(await linkStatus(child, link.id)).toBe('used');
        }
      },
    );

    it.each<[string, () => Promise<LinkUse>]>([
      [
        'logs in',
        async () => {
          const child = await withPassword();
          return { child, route: 'login', body: { password: child.password, remember: true } };
        },
      ],
      [
        'sets the password',
        async () => ({
          child: await newChild(),
          route: 'password',
          body: { password: 'my secret', remember: true },
        }),
      ],
    ])(
      '%s or is link_invalid, and never fails, while a parent makes a newer link at the same time',
      async (_case, prepare) => {
        for (let round = 0; round < RACE_ROUNDS; round += 1) {
          const { child, route, body } = await prepare();
          const link = await linkOf(child);

          const [use, newer] = await Promise.all([
            browser().post(`${linkPath(link.token)}/${route}`, body),
            newerLink(child),
          ]);

          expect(newer.status).toBe(201);
          expect([200, 404]).toContain(use.status);
          expect(await linkStatus(child, link.id)).toBe(use.status === 200 ? 'used' : 'revoked');
        }
      },
    );

    it('works until its time is up and is link_invalid from then on, setting nothing', async () => {
      const child = await newChild();
      const link = await linkOf(child);

      const before = await browser().get(linkPath(link.token));
      await expireLoginLink(running.redisUrl, { ...link, childId: child.id });
      const after = await browser().get(linkPath(link.token));
      const setting = await browser().post(`${linkPath(link.token)}/password`, {
        password: 'my secret',
        remember: false,
      });

      expect(before.status).toBe(200);
      expect([after.status, errorCodeOf(after)]).toEqual([404, 'link_invalid']);
      expect([setting.status, errorCodeOf(setting)]).toEqual([404, 'link_invalid']);
      expect((await childRow(running.databaseUrl, child.id))?.password_hash).toBeNull();
      expect(await linkStatus(child, link.id)).toBe('expired');
    });

    it('stops working once a newer link is made', async () => {
      const child = await newChild();
      const older = await linkOf(child);
      const newer = await linkOf(child);

      const olderInfo = await browser().get(linkPath(older.token));
      const newerInfo = await browser().get(linkPath(newer.token));

      expect([olderInfo.status, errorCodeOf(olderInfo)]).toEqual([404, 'link_invalid']);
      expect(newerInfo.status).toBe(200);
    });

    it('is link_invalid once its child is deleted, and for a token that was never made', async () => {
      const child = await newChild();
      const link = await linkOf(child);
      await as(running.server, parent).delete(childPath(family.id, child.id)).expect(204);

      const responses = [
        await browser().get(linkPath(link.token)),
        await browser().post(`${linkPath(link.token)}/password`, {
          password: 'my secret',
          remember: false,
        }),
        await browser().get(linkPath(Buffer.alloc(32, 7).toString('base64url'))),
        await browser().get(linkPath('not-a-token')),
      ];

      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(errorCodeOf(response)).toBe('link_invalid');
      }
    });
  });

  describe("the child's login", () => {
    it('is needed for GET /api/child/me', async () => {
      const response = await browser().me();

      expect(response.status).toBe(401);
      expect(errorCodeOf(response)).toBe('unauthenticated');
    });

    it('ends when a parent resets the password, and the remembered device goes with it', async () => {
      const { child, kid } = await rememberedChild();

      expect((await resetPassword(child)).status).toBe(204);

      const me = await kid.me();
      expect(me.status).toBe(401);
      expect(errorCodeOf(me)).toBe('unauthenticated');
      expect(await devicesOf(child.id)).toEqual([]);
      expect((await kid.get('/api/child-auth/remembered')).body).toEqual([]);
      expect((await kid.loginRemembered(child.id)).status).toBe(401);
    });

    it('counts a login issued right after the child was added', async () => {
      const child = await newChild();
      const link = await linkOf(child);
      const kid = browser();

      await setPasswordOnLink(kid, link.token);

      expect((await kid.me()).status).toBe(200);
    });

    it('ends when the child is deleted', async () => {
      const child = await withPassword();
      const kid = browser();
      await kid.login(loginOf(child));

      await as(running.server, parent).delete(childPath(family.id, child.id)).expect(204);

      const me = await kid.me();
      expect(me.status).toBe(401);
      expect(errorCodeOf(me)).toBe('unauthenticated');
    });

    it('logs out the child only, keeping the device cookie, the avatar and a parent signed in', async () => {
      const { child, kid } = await rememberedChild();
      kid.signInParent(parent);

      const response = await kid.post('/api/child-auth/logout');

      expect(response.status).toBe(204);
      const cookies = setCookiesOf(response);
      expect(Object.keys(cookies)).toEqual([CHILD_SESSION_COOKIE]);
      expectCleared(cookies[CHILD_SESSION_COOKIE]);
      expect((await kid.me()).status).toBe(401);
      expect((await kid.get('/api/child-auth/remembered')).body).toEqual([
        expect.objectContaining({ childId: child.id }),
      ]);
      expect((await kid.get('/api/me')).status).toBe(200);
      expect((await kid.loginRemembered(child.id)).status).toBe(200);
    });

    it('logs out a browser without a login as well', async () => {
      expect((await browser().post('/api/child-auth/logout')).status).toBe(204);
    });
  });
});
