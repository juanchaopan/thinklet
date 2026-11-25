import type { FamilyDetail } from '@thinklet/contracts';
import { createClient } from 'redis';
import request from 'supertest';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import {
  ChildBrowser,
  IPAD_SAFARI,
  addChildWithPassword,
  linkPath,
  newLoginLink,
  type ChildWithPassword,
} from '../support/child-login.js';
import { TEST_CLIENT_IP_HEADER } from '../support/containers.js';
import { as, createFamily, signInParent, type Parent } from '../support/families.js';
import { newClientIp, unknownFamilyCode } from '../support/rate-limits.js';

const HEX_64 = '[0-9a-f]{64}';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The level pino writes an error at. */
const ERROR_LEVEL = 50;

/** The entries of the api's output, one JSON line each, whose message is the one given. */
function entriesWithMessage(output: string, message: string): Array<{ level?: unknown }> {
  return output
    .split('\n')
    .filter((line) => line.includes(JSON.stringify(message)))
    .map((line) => JSON.parse(line) as { level?: unknown; msg?: unknown })
    .filter((entry) => entry.msg === message);
}

/** Everything Redis holds: each key with its value and its time to live in seconds. */
async function redisContents(
  url: string,
): Promise<Array<{ key: string; value: string | null; ttl: number }>> {
  const client = createClient({ url });
  await client.connect();
  try {
    const keys = await client.keys('*');
    return await Promise.all(
      keys.map(async (key) => ({ key, value: await client.get(key), ttl: await client.ttl(key) })),
    );
  } finally {
    client.destroy();
  }
}

/** A family with a child who has a password, set up through the built api. */
async function familyWithChild(
  api: string,
): Promise<{ parent: Parent; family: FamilyDetail; child: ChildWithPassword }> {
  const parent = await signInParent(api);
  const family = await createFamily(api, parent);
  const child = await addChildWithPassword(api, parent, family.id);
  return { parent, family, child };
}

// Acceptance criterion 28: Redis never holds a source's IP address, only
// its HMAC, nor any personal data in clear, and every key lives no longer
// than its window; the logs hold no client IP address either; and when
// Redis cannot be reached, the logins go on uncounted and an error is
// logged. The built api runs as a separate process, and everything it
// writes is read as the platform's log collector would.
describe('rate limits and the client IP address', () => {
  describe('with Redis up', () => {
    let started: BuiltAppWithServices;
    let output: string;
    let contents: Awaited<ReturnType<typeof redisContents>>;
    const clientIp = newClientIp();
    let child: ChildWithPassword;

    beforeAll(async () => {
      started = await startBuiltAppWithServices();
      const { api, services } = started;
      const setup = await familyWithChild(api);
      child = setup.child;
      const kid = new ChildBrowser(api, IPAD_SAFARI, clientIp);
      const code = setup.family.code;

      expect(
        (await kid.login({ code, account: child.account, password: 'wrong 1', remember: false }))
          .status,
      ).toBe(401);
      expect(
        (await kid.login({ code, account: 'nobody', password: 'wrong 2', remember: false })).status,
      ).toBe(401);
      const { token } = await newLoginLink(api, setup.parent, setup.family.id, child.id);
      expect(
        (await kid.post(`${linkPath(token)}/login`, { password: 'wrong 3', remember: false }))
          .status,
      ).toBe(401);
      await as(api, setup.parent)
        .get(`/api/family-codes/${unknownFamilyCode()}`)
        .set(TEST_CLIENT_IP_HEADER, clientIp)
        .expect(404);
      await request(api)
        .get('/api/client-ip')
        .set('X-Real-IP', clientIp)
        .set('X-Forwarded-For', clientIp)
        .set('X-Vercel-Forwarded-For', clientIp)
        .expect(200);

      contents = await redisContents(services.redis.url);
      output = await started.stopApp();
    });

    afterAll(async () => {
      await started?.stop();
    });

    it('keys the counts by the HMAC of the source, never the address, and holds only counts', () => {
      const rateKeys = contents.filter(({ key }) => key.startsWith('rate:'));

      expect(rateKeys.map(({ key }) => key).sort()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(new RegExp(`^rate:child-login:${HEX_64}$`)),
          expect.stringMatching(new RegExp(`^rate:child-login:${HEX_64}:${UUID}$`)),
          expect.stringMatching(new RegExp(`^rate:child-login:${HEX_64}:${HEX_64}$`)),
          expect.stringMatching(new RegExp(`^rate:family-code:${HEX_64}$`)),
        ]),
      );
      for (const { value } of rateKeys) {
        expect(value).toMatch(/^\d+$/);
      }
    });

    it('holds no client IP address, family code or account in clear', () => {
      const everything = JSON.stringify(contents);

      expect(everything).not.toContain(clientIp);
      expect(everything).not.toContain('nobody');
      expect(everything).not.toContain(child.account);
    });

    it('lets every count live at most its window', () => {
      for (const { key, ttl } of contents.filter((entry) => entry.key.startsWith('rate:'))) {
        const window = key.startsWith('rate:family-code:') ? 60 * 60 : 15 * 60;
        expect(ttl, key).toBeGreaterThan(0);
        expect(ttl, key).toBeLessThanOrEqual(window);
      }
    });

    it('writes no client IP address to the logs', () => {
      expect(output.length).toBeGreaterThan(0);
      expect(output).not.toContain(clientIp);
    });
  });

  describe('with Redis down', () => {
    let started: BuiltAppWithServices;
    let output: string;
    const clientIp = newClientIp();
    const statuses: number[] = [];

    beforeAll(async () => {
      started = await startBuiltAppWithServices();
      const { api, services } = started;
      const { family, child } = await familyWithChild(api);
      await services.redis.container.stop();
      const kid = new ChildBrowser(api, IPAD_SAFARI, clientIp);
      const login = (password: string) =>
        kid.login({ code: family.code, account: child.account, password, remember: false });

      for (let attempt = 0; attempt < 11; attempt += 1) {
        statuses.push((await login(`wrong ${attempt}`)).status);
      }
      statuses.push((await login(child.password)).status);

      output = await started.stopApp();
    });

    afterAll(async () => {
      await started?.stop();
    });

    it('lets the logins through uncounted: past the limit, a wrong password is still checked and the right one signs in', () => {
      expect(statuses).toEqual([...Array<number>(11).fill(401), 200]);
    });

    it('logs an error for each login it could not count, without the client IP address', () => {
      const notApplied = entriesWithMessage(output, 'Rate limit not applied: Redis failed');

      expect(notApplied).toHaveLength(12);
      expect(notApplied.every((entry) => entry.level === ERROR_LEVEL)).toBe(true);
      expect(output).not.toContain(clientIp);
    });
  });
});
