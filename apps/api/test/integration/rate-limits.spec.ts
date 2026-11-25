import type { FamilyDetail } from '@thinklet/contracts';
import type request from 'supertest';
import {
  ChildBrowser,
  IPAD_SAFARI,
  addChildWithPassword,
  linkPath,
  newLoginLink,
  type ChildWithPassword,
} from '../support/child-login.js';
import { TEST_CLIENT_IP_HEADER } from '../support/containers.js';
import {
  as,
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { expectRateLimited, newClientIp, unknownFamilyCode } from '../support/rate-limits.js';

/** The limits of rules.md, 限流. */
const CHILD_WINDOW_SECONDS = 15 * 60;
const PER_CHILD = 10;
const PER_SOURCE = 200;
const FAMILY_CODE_WINDOW_SECONDS = 60 * 60;
const FAMILY_CODE_MISSES = 30;

/** How many attempts over a limit a burst sends at the same time. */
const BURST_EXTRA = 15;

// Acceptance criterion 28: the child login with the family code, the account
// and the password, the password on a QR login page and a parent's family
// code lookup are refused once a source has failed too often in a window;
// only failures count; another child behind the same source still logs in.
describe('rate limits by source', () => {
  const running = useAppWithServices();
  let parent: Parent;
  let family: FamilyDetail;

  /** A browser of a child behind the given source. */
  const browserAt = (clientIp: string) => new ChildBrowser(running.server, IPAD_SAFARI, clientIp);
  const withPassword = () => addChildWithPassword(running.server, parent, family.id);
  const loginOf = (child: ChildWithPassword, password = child.password) => ({
    code: family.code,
    account: child.account,
    password,
    remember: false,
  });
  const wrongLogin = (child: ChildWithPassword) => loginOf(child, `wrong ${child.password}`);

  /** Sends the login `times` times from the browser and returns the statuses. */
  async function statusesOf(
    times: number,
    send: () => Promise<request.Response>,
  ): Promise<number[]> {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < times; attempt += 1) {
      statuses.push((await send()).status);
    }
    return statuses;
  }

  /** Sends the request `times` times at once and returns how many got each status. */
  async function burstOf(
    times: number,
    send: () => Promise<request.Response>,
  ): Promise<Record<number, number>> {
    const responses = await Promise.all(Array.from({ length: times }, send));
    const counts: Record<number, number> = {};
    for (const { status } of responses) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }

  beforeAll(async () => {
    parent = await signInParent(running.server);
    family = await createFamily(running.server, parent);
  });

  describe('child login with the family code and the account', () => {
    it('refuses a source after 10 failures on a child, before checking even the right password', async () => {
      const child = await withPassword();
      const kid = browserAt(newClientIp());

      expect(await statusesOf(PER_CHILD, () => kid.login(wrongLogin(child)))).toEqual(
        Array<number>(PER_CHILD).fill(401),
      );
      const refused = await kid.login(loginOf(child));

      expectRateLimited(refused, CHILD_WINDOW_SECONDS);
      expect(refused.headers['set-cookie']).toBeUndefined();
    });

    it('checks no more than 10 wrong passwords on a child sent at the same time', async () => {
      const child = await withPassword();
      const sibling = await withPassword();
      const clientIp = newClientIp();

      expect(
        await burstOf(PER_CHILD + BURST_EXTRA, () => browserAt(clientIp).login(wrongLogin(child))),
      ).toEqual({ 401: PER_CHILD, 429: BURST_EXTRA });

      expectRateLimited(await browserAt(clientIp).login(loginOf(child)), CHILD_WINDOW_SECONDS);
      expect((await browserAt(clientIp).login(loginOf(sibling))).status).toBe(200);
    });

    it('does not count a successful login', async () => {
      const child = await withPassword();
      const kid = browserAt(newClientIp());

      await statusesOf(PER_CHILD - 1, () => kid.login(wrongLogin(child)));
      expect(await statusesOf(5, () => kid.login(loginOf(child)))).toEqual([
        200, 200, 200, 200, 200,
      ]);
      expect((await kid.login(wrongLogin(child))).status).toBe(401);

      expectRateLimited(await kid.login(loginOf(child)), CHILD_WINDOW_SECONDS);
    });

    it('does not count successful logins sent at the same time', async () => {
      const child = await withPassword();
      const clientIp = newClientIp();

      expect(await burstOf(PER_CHILD, () => browserAt(clientIp).login(loginOf(child)))).toEqual({
        200: PER_CHILD,
      });

      expect(
        await statusesOf(PER_CHILD, () => browserAt(clientIp).login(wrongLogin(child))),
      ).toEqual(Array<number>(PER_CHILD).fill(401));
    });

    it('lets another child behind the same source log in, and the child from another source', async () => {
      const child = await withPassword();
      const sibling = await withPassword();
      const clientIp = newClientIp();
      await statusesOf(PER_CHILD, () => browserAt(clientIp).login(wrongLogin(child)));

      expect((await browserAt(clientIp).login(loginOf(sibling))).status).toBe(200);
      expect((await browserAt(newClientIp()).login(loginOf(child))).status).toBe(200);
    });

    it('counts a code and an account that match no child as one, however the code is cased', async () => {
      const clientIp = newClientIp();
      const nobody = {
        code: family.code,
        account: `nobody${String(Date.now()).slice(-6)}`,
        password: 'any password',
        remember: false,
      };
      await statusesOf(PER_CHILD, () => browserAt(clientIp).login(nobody));

      expectRateLimited(
        await browserAt(clientIp).login({ ...nobody, code: family.code.toLowerCase() }),
        CHILD_WINDOW_SECONDS,
      );
      expect(
        (await browserAt(clientIp).login({ ...nobody, account: `${nobody.account}x` })).status,
      ).toBe(401);
    });

    it('refuses a source after 200 failures on all children together', async () => {
      const child = await withPassword();
      const clientIp = newClientIp();
      const kid = browserAt(clientIp);
      for (let attempt = 0; attempt < PER_SOURCE; attempt += 1) {
        const response = await kid.login({
          code: family.code,
          account: `nobody${attempt}`,
          password: 'any password',
          remember: false,
        });
        expect(response.status).toBe(401);
      }

      expectRateLimited(await kid.login(loginOf(child)), CHILD_WINDOW_SECONDS);
    }, 120_000);
  });

  describe('QR login with the password', () => {
    /** Logs in on a new link of the child, from a browser behind the source. */
    async function linkLogin(child: ChildWithPassword, clientIp: string, password: string) {
      const { token } = await newLoginLink(running.server, parent, family.id, child.id);
      return browserAt(clientIp).post(`${linkPath(token)}/login`, { password, remember: false });
    }

    it('counts a wrong password together with the logins by account, and refuses the source on the link', async () => {
      const child = await withPassword();
      const clientIp = newClientIp();
      const { token } = await newLoginLink(running.server, parent, family.id, child.id);
      const onLink = () =>
        browserAt(clientIp).post(`${linkPath(token)}/login`, {
          password: `wrong ${child.password}`,
          remember: false,
        });

      expect(await statusesOf(PER_CHILD / 2, onLink)).toEqual([401, 401, 401, 401, 401]);
      await statusesOf(PER_CHILD / 2, () => browserAt(clientIp).login(wrongLogin(child)));
      const refused = await browserAt(clientIp).post(`${linkPath(token)}/login`, {
        password: child.password,
        remember: false,
      });

      expectRateLimited(refused, CHILD_WINDOW_SECONDS);
      expect((await linkLogin(child, newClientIp(), child.password)).status).toBe(200);
    });
  });

  describe('family code lookup', () => {
    const lookUp = (applicant: Parent, code: string, clientIp: string) =>
      as(running.server, applicant)
        .get(`/api/family-codes/${code}`)
        .set(TEST_CLIENT_IP_HEADER, clientIp);

    it('refuses a source after 30 codes not found in an hour, before looking up even a code that exists', async () => {
      const applicant = await signInParent(running.server);
      const clientIp = newClientIp();

      expect(
        await statusesOf(FAMILY_CODE_MISSES, () =>
          lookUp(applicant, unknownFamilyCode(), clientIp),
        ),
      ).toEqual(Array<number>(FAMILY_CODE_MISSES).fill(404));

      expectRateLimited(await lookUp(applicant, family.code, clientIp), FAMILY_CODE_WINDOW_SECONDS);
      expect((await lookUp(applicant, family.code, newClientIp())).status).toBe(200);
    });

    it('looks up no more than 30 codes not found sent at the same time', async () => {
      const applicant = await signInParent(running.server);
      const clientIp = newClientIp();

      expect(
        await burstOf(FAMILY_CODE_MISSES + BURST_EXTRA, () =>
          lookUp(applicant, unknownFamilyCode(), clientIp),
        ),
      ).toEqual({ 404: FAMILY_CODE_MISSES, 429: BURST_EXTRA });
    });

    it('counts only codes not found: neither a family found nor one the parent is in', async () => {
      const applicant = await signInParent(running.server);
      const clientIp = newClientIp();

      expect(
        await statusesOf(FAMILY_CODE_MISSES, () => lookUp(applicant, family.code, clientIp)),
      ).toEqual(Array<number>(FAMILY_CODE_MISSES).fill(200));
      expect(
        await statusesOf(FAMILY_CODE_MISSES, () => lookUp(parent, family.code, clientIp)),
      ).toEqual(Array<number>(FAMILY_CODE_MISSES).fill(409));
      expect((await lookUp(applicant, unknownFamilyCode(), clientIp)).status).toBe(404);
    });
  });

  describe('a request without the client IP header', () => {
    it('is not limited, as there is no source to count it by', async () => {
      const child = await withPassword();
      const kid = new ChildBrowser(running.server);

      expect(await statusesOf(PER_CHILD + 1, () => kid.login(wrongLogin(child)))).toEqual(
        Array<number>(PER_CHILD + 1).fill(401),
      );
    });
  });
});
