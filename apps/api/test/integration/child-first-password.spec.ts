import {
  childListSchema,
  errorResponseSchema,
  type Child,
  type FamilyDetail,
} from '@thinklet/contracts';
import type request from 'supertest';
import { auditRows, refusingAuditOf, rowsAddedBy } from '../support/audit.js';
import {
  CHILD_SESSION_COOKIE,
  ChildBrowser,
  DEVICE_COOKIE,
  IPAD_SAFARI,
  linkPath,
  newLoginLink,
} from '../support/child-login.js';
import {
  addChild,
  childPath,
  childRow,
  childrenPath,
  deviceRows,
  endPasswordSetup,
  passwordSetupOf,
} from '../support/children.js';
import { query } from '../support/database.js';
import {
  as,
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { expectLoginCookieAttributes, setCookiesOf } from '../support/login.js';
import { expectRateLimited, newClientIp } from '../support/rate-limits.js';

/** How long a child has to set a password with the account after it is added or reset. */
const SETUP_MS = 48 * 60 * 60 * 1000;

/** How far the database's clock may move between a write and the test reading it back. */
const CLOCK_SLACK_MS = 5_000;

/** The limits of rules.md, 限流, which setting a password with the account counts towards. */
const CHILD_WINDOW_SECONDS = 15 * 60;
const PER_CHILD = 10;

/** The error code of an error response. */
function errorCodeOf(response: request.Response): string {
  return errorResponseSchema.parse(response.body).error.code;
}

/** Asserts a refusal that tells nothing but login_failed and signs nobody in. */
function expectLoginFailed(response: request.Response): void {
  expect(response.status).toBe(401);
  expect(errorCodeOf(response)).toBe('login_failed');
  expect(response.headers['set-cookie']).toBeUndefined();
}

// Acceptance criterion 25: a child without a password sets one at the
// first login (rules.md, 孩子的密码). With the family code and the account
// that is only within 48 hours, by the database's clock, of a parent
// adding the child or resetting the password: the login answers that the
// child has to set one, the password route sets it once and signs the
// child in, and afterwards the window is closed and the password needed;
// past the window both answer login_failed, while a QR code still sets it.
// The children list says who has no password yet and until when. Setting
// a password counts towards the limits of a source as a login does, and is
// recorded as child.password_set by the child, via the account.
describe('a child setting the first password', () => {
  const running = useAppWithServices();
  let parent: Parent;
  let family: FamilyDetail;

  const browser = () => new ChildBrowser(running.server);
  const newChild = () => addChild(running.server, parent, family.id);
  const loginWithout = (child: Child) => ({
    code: family.code,
    account: child.account,
    remember: false,
  });
  const firstPassword = (child: Child, password = 'dd 2019', remember = false) => ({
    code: family.code,
    account: child.account,
    password,
    remember,
  });
  const listed = async (child: Child) =>
    childListSchema
      .parse((await as(running.server, parent).get(childrenPath(family.id)).expect(200)).body)
      .find(({ id }) => id === child.id);
  const resetPassword = (child: Child) =>
    as(running.server, parent)
      .post(`${childPath(family.id, child.id)}/password-reset`)
      .expect(204);

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

  /** Asserts that the child may set a password with the account until 48 hours after `from`, by the database's clock. */
  async function expectWindowFrom(child: Child, from: Date): Promise<Date> {
    const { now, until } = await passwordSetupOf(running.databaseUrl, child.id);
    expect(until).not.toBeNull();
    const untilMs = until?.getTime() ?? Number.NaN;
    expect(untilMs).toBeGreaterThanOrEqual(from.getTime() + SETUP_MS - CLOCK_SLACK_MS);
    expect(untilMs).toBeLessThanOrEqual(now.getTime() + SETUP_MS);
    return until ?? new Date(Number.NaN);
  }

  beforeAll(async () => {
    parent = await signInParent(running.server, { name: '林悦' });
    family = await createFamily(running.server, parent);
  });

  describe('a child just added', () => {
    it('has no password and 48 hours by the database’s clock to set one with the account', async () => {
      const before = await databaseNow();

      const child = await newChild();

      const until = await expectWindowFrom(child, before);
      expect(child).toMatchObject({ passwordSet: false, passwordSetupUntil: until.toISOString() });
      expect(await listed(child)).toEqual(child);
      expect((await childRow(running.databaseUrl, child.id))?.password_hash).toBeNull();
    });

    it.each<[string, { password?: string }]>([
      ['without a password', {}],
      ['with any password typed', { password: 'whatever' }],
    ])(
      'is answered %s that it has to set one, signing nobody in and changing nothing',
      async (_case, typed) => {
        const child = await newChild();
        const before = await childRow(running.databaseUrl, child.id);

        const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
          browser().login({ ...loginWithout(child), ...typed }),
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ needsPassword: true, id: child.id, nickname: '小米' });
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(await childRow(running.databaseUrl, child.id)).toEqual(before);
        expect(added).toEqual([]);
      },
    );

    it('sets the password with the family code and the account and is signed in', async () => {
      const child = await newChild();
      const kid = browser();

      const response = await kid.setFirstPassword(firstPassword(child));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: child.id, nickname: '小米' });
      const session = setCookiesOf(response)[CHILD_SESSION_COOKIE];
      expectLoginCookieAttributes(session);
      expect((await kid.me()).body).toEqual({ id: child.id, nickname: '小米' });
      const row = await childRow(running.databaseUrl, child.id);
      expect(row?.password_hash).toMatch(/^\$argon2id\$v=19\$/);
      expect(row?.password_setup_until).toBeNull();
      expect(await listed(child)).toMatchObject({ passwordSet: true, passwordSetupUntil: null });
    });

    it('takes the family code in any case and remembers the browser when asked', async () => {
      const child = await newChild();

      const response = await browser().setFirstPassword({
        ...firstPassword(child, 'dd 2019', true),
        code: family.code.toLowerCase(),
      });

      expect(response.status).toBe(200);
      expect(setCookiesOf(response)[DEVICE_COOKIE]?.value).toBeTruthy();
      expect(await deviceRows(running.databaseUrl, child.id)).toHaveLength(1);
    });

    it('records the password set by the child, via the account, in the audit events', async () => {
      const child = await newChild();

      const { added } = await rowsAddedBy(running.databaseUrl, () =>
        browser().setFirstPassword(firstPassword(child)),
      );

      expect(added).toEqual([
        expect.objectContaining({
          actor_kind: 'child',
          actor_id: child.id,
          actor_issuer: null,
          actor_subject: null,
          action: 'child.password_set',
          target_kind: 'child',
          target_id: child.id,
          family_id: family.id,
          details: { via: 'account' },
        }),
      ]);
    });

    it('sets nothing and signs nobody in when the audit event cannot be written', async () => {
      const child = await newChild();
      const before = await childRow(running.databaseUrl, child.id);

      const response = await refusingAuditOf(running.databaseUrl, 'child.password_set', () =>
        browser().setFirstPassword(firstPassword(child)),
      );

      expect(response.status).toBe(500);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await childRow(running.databaseUrl, child.id)).toEqual(before);
    });

    it('refuses a password of the wrong length with the field, setting nothing', async () => {
      const child = await newChild();

      const response = await browser().setFirstPassword(firstPassword(child, '12345'));

      expect(response.status).toBe(400);
      expect(errorResponseSchema.parse(response.body).error).toMatchObject({
        code: 'invalid_request',
        fields: [{ path: 'password', code: 'too_short' }],
      });
      expect((await childRow(running.databaseUrl, child.id))?.password_hash).toBeNull();
    });
  });

  describe('once the password is set', () => {
    it('needs the password at login, and a second password cannot be set', async () => {
      const child = await newChild();
      expect((await browser().setFirstPassword(firstPassword(child))).status).toBe(200);

      expectLoginFailed(await browser().login(loginWithout(child)));
      expectLoginFailed(await browser().setFirstPassword(firstPassword(child, 'another one')));
      const login = await browser().login({ ...loginWithout(child), password: 'dd 2019' });
      expect(login.status).toBe(200);
      expect(login.body).toEqual({ id: child.id, nickname: '小米' });
    });

    it('lets only one of two settings at the same time set it', async () => {
      const child = await newChild();

      const responses = await Promise.all([
        browser().setFirstPassword(firstPassword(child, 'first one')),
        browser().setFirstPassword(firstPassword(child, 'second one')),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
      const won = responses[0]?.status === 200 ? 'first one' : 'second one';
      expect((await browser().login({ ...loginWithout(child), password: won })).status).toBe(200);
      expect(
        (await auditRows(running.databaseUrl)).filter(
          (row) => row.action === 'child.password_set' && row.target_id === child.id,
        ),
      ).toHaveLength(1);
    });
  });

  describe('once the time to set it with the account has run out', () => {
    it('answers the login with and without a password, and the setting, with login_failed', async () => {
      const child = await newChild();
      await endPasswordSetup(running.databaseUrl, child.id);

      expectLoginFailed(await browser().login(loginWithout(child)));
      expectLoginFailed(await browser().login({ ...loginWithout(child), password: 'dd 2019' }));
      expectLoginFailed(await browser().setFirstPassword(firstPassword(child)));
      expect((await childRow(running.databaseUrl, child.id))?.password_hash).toBeNull();
    });

    it('still lets the child set the password with a login QR code, which ends the time', async () => {
      const child = await newChild();
      await endPasswordSetup(running.databaseUrl, child.id);
      const { token } = await newLoginLink(running.server, parent, family.id, child.id);

      const response = await browser().post(`${linkPath(token)}/password`, {
        password: 'dd 2019',
        remember: false,
      });

      expect(response.status).toBe(200);
      expect((await childRow(running.databaseUrl, child.id))?.password_setup_until).toBeNull();
      expect(await listed(child)).toMatchObject({ passwordSet: true, passwordSetupUntil: null });
    });

    it('is listed for the parents with the time it ran out', async () => {
      const child = await newChild();
      await endPasswordSetup(running.databaseUrl, child.id);
      const { now, until } = await passwordSetupOf(running.databaseUrl, child.id);

      const shown = await listed(child);

      expect(shown).toMatchObject({ passwordSet: false, passwordSetupUntil: until?.toISOString() });
      expect(new Date(shown?.passwordSetupUntil ?? '').getTime()).toBeLessThan(now.getTime());
    });
  });

  describe('a password reset', () => {
    it('clears the password and opens 48 hours by the database’s clock to set a new one with the account', async () => {
      const child = await newChild();
      expect((await browser().setFirstPassword(firstPassword(child))).status).toBe(200);
      const before = await databaseNow();

      await resetPassword(child);

      const row = await childRow(running.databaseUrl, child.id);
      expect(row?.password_hash).toBeNull();
      expect(row?.sessions_valid_after.getTime()).toBeGreaterThan(before.getTime());
      const until = await expectWindowFrom(child, before);
      expect(await listed(child)).toMatchObject({
        passwordSet: false,
        passwordSetupUntil: until.toISOString(),
      });
      const login = await browser().login({ ...loginWithout(child), password: 'dd 2019' });
      expect(login.body).toEqual({ needsPassword: true, id: child.id, nickname: '小米' });
    });

    it('reopens the time for a child whose time had run out, and the child sets a new password', async () => {
      const child = await newChild();
      await endPasswordSetup(running.databaseUrl, child.id);

      await resetPassword(child);

      expect((await browser().login(loginWithout(child))).body).toMatchObject({
        needsPassword: true,
      });
      expect((await browser().setFirstPassword(firstPassword(child, 'new one'))).status).toBe(200);
    });
  });

  describe('the limits of a source', () => {
    const browserAt = (clientIp: string) => new ChildBrowser(running.server, IPAD_SAFARI, clientIp);

    it('counts a refused setting as a failed login, and refuses the source at the limit', async () => {
      const child = await newChild();
      await endPasswordSetup(running.databaseUrl, child.id);
      const kid = browserAt(newClientIp());

      for (let attempt = 0; attempt < PER_CHILD; attempt += 1) {
        expect((await kid.setFirstPassword(firstPassword(child))).status).toBe(401);
      }

      expectRateLimited(await kid.setFirstPassword(firstPassword(child)), CHILD_WINDOW_SECONDS);
      expectRateLimited(await kid.login(loginWithout(child)), CHILD_WINDOW_SECONDS);
    });

    it('shares the count with the logins of the child, and does not count a child asked to set one', async () => {
      const child = await newChild();
      const clientIp = newClientIp();
      for (let attempt = 0; attempt < PER_CHILD; attempt += 1) {
        expect((await browserAt(clientIp).login(loginWithout(child))).status).toBe(200);
      }
      await endPasswordSetup(running.databaseUrl, child.id);
      for (let attempt = 0; attempt < PER_CHILD; attempt += 1) {
        expect((await browserAt(clientIp).login(loginWithout(child))).status).toBe(401);
      }

      expectRateLimited(
        await browserAt(clientIp).setFirstPassword(firstPassword(child)),
        CHILD_WINDOW_SECONDS,
      );
    });
  });
});
