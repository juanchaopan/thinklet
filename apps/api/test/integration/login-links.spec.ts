import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../src/infrastructure/config/environment.js';
import { RedisService } from '../../src/infrastructure/redis/redis.service.js';
import { LoginLinks, type NewLoginLink } from '../../src/modules/child/login-links.js';
import { newToken } from '../../src/modules/child/tokens.js';
import { startRedis, type StartedRedis } from '../support/containers.js';
import { withRedis } from '../support/login-links.js';

/** How many uses of one link the test of uses at the same time sends at once. */
const USES_AT_ONCE = 20;

/** A RedisService on the Redis at the address, connected. */
async function connectedRedis(url: string): Promise<RedisService> {
  const service = new RedisService({ get: () => url } as unknown as ConfigService<
    Environment,
    true
  >);
  service.onModuleInit();
  await service.ping();
  return service;
}

/** A new link of the child, expiring ten minutes from now, with its token. */
function newLink(childId: string): NewLoginLink & { token: string } {
  const { token, hash } = newToken();
  return {
    token,
    linkId: randomUUID(),
    childId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  };
}

// The login links in Redis on their own (#14, 24): a link is used once,
// even by many uses at the same moment, since the use is one Redis script;
// a newer link of the child makes the older one unusable; the keys of a
// deleted child's link are removed. These need a real Redis, as they are
// the Lua scripts' behaviour.
describe('LoginLinks', () => {
  let redis: StartedRedis;
  let service: RedisService;
  let links: LoginLinks;

  beforeAll(async () => {
    redis = await startRedis();
    service = await connectedRedis(redis.url);
    links = new LoginLinks(service);
  });

  afterAll(async () => {
    service?.onApplicationShutdown();
    await redis?.container.stop();
  });

  it('finds a new link by the hash of its token until it is used', async () => {
    const link = newLink(randomUUID());
    await links.create(link);

    const found = await links.find(link.tokenHash);

    expect(found).toEqual({
      linkId: link.linkId,
      childId: link.childId,
      tokenHash: link.tokenHash,
      expiresAt: link.expiresAt.toISOString(),
    });
    expect(await links.state(link.linkId)).toEqual({
      childId: link.childId,
      status: 'active',
      expiresAt: link.expiresAt.toISOString(),
    });
  });

  it('lets only one of many uses at the same moment take a link, and marks it used', async () => {
    const link = newLink(randomUUID());
    await links.create(link);
    const found = await links.find(link.tokenHash);
    if (found === undefined) {
      throw new Error('The link was not found');
    }

    const taken = await Promise.all(Array.from({ length: USES_AT_ONCE }, () => links.take(found)));

    expect(taken.filter(Boolean)).toHaveLength(1);
    expect(await links.find(link.tokenHash)).toBeUndefined();
    expect(await links.state(link.linkId)).toMatchObject({ status: 'used' });
  });

  it('makes the older link of the child unusable and revoked once a newer one is made', async () => {
    const childId = randomUUID();
    const older = newLink(childId);
    const newer = newLink(childId);
    await links.create(older);
    const olderFound = await links.find(older.tokenHash);

    await links.create(newer);

    expect(await links.find(older.tokenHash)).toBeUndefined();
    expect(olderFound === undefined ? undefined : await links.take(olderFound)).toBe(false);
    expect(await links.state(older.linkId)).toMatchObject({ status: 'revoked' });
    expect(await links.find(newer.tokenHash)).toMatchObject({ linkId: newer.linkId });
  });

  it('leaves a used link used when a newer one is made', async () => {
    const childId = randomUUID();
    const used = newLink(childId);
    await links.create(used);
    const found = await links.find(used.tokenHash);
    expect(found === undefined ? false : await links.take(found)).toBe(true);

    await links.create(newLink(childId));

    expect(await links.state(used.linkId)).toMatchObject({ status: 'used' });
  });

  it("leaves another child's link as it is", async () => {
    const theirs = newLink(randomUUID());
    await links.create(theirs);

    await links.create(newLink(randomUUID()));

    expect(await links.find(theirs.tokenHash)).toMatchObject({ linkId: theirs.linkId });
  });

  it('removes every key of the current links of deleted children, and only theirs', async () => {
    const first = newLink(randomUUID());
    const second = newLink(randomUUID());
    const kept = newLink(randomUUID());
    for (const link of [first, second, kept]) {
      await links.create(link);
    }

    await links.removeOf([first.childId, second.childId, randomUUID()]);

    const keys = await withRedis(redis.url, (client) => client.keys('*'));
    for (const link of [first, second]) {
      expect(keys.filter((key) => key.includes(link.linkId) || key.includes(link.childId))).toEqual(
        [],
      );
      expect(keys).not.toContain(`login-link:${link.tokenHash}`);
    }
    expect(await links.find(kept.tokenHash)).toMatchObject({ linkId: kept.linkId });
  });

  it('removes nothing, and asks Redis nothing, for no children', async () => {
    await expect(links.removeOf([])).resolves.toBeUndefined();
  });

  describe('with Redis down', () => {
    let downRedis: StartedRedis;
    let downService: RedisService;
    let downLinks: LoginLinks;

    beforeAll(async () => {
      downRedis = await startRedis();
      downService = await connectedRedis(downRedis.url);
      downLinks = new LoginLinks(downService);
      await downRedis.container.stop();
    });

    afterAll(() => {
      downService?.onApplicationShutdown();
    });

    it('fails to make, find or use a link', async () => {
      const link = newLink(randomUUID());

      await expect(downLinks.create(link)).rejects.toThrow();
      await expect(downLinks.find(link.tokenHash)).rejects.toThrow();
      await expect(
        downLinks.take({
          linkId: link.linkId,
          childId: link.childId,
          tokenHash: link.tokenHash,
          expiresAt: link.expiresAt.toISOString(),
        }),
      ).rejects.toThrow();
    });

    it('resolves the removal of deleted children’s links, which cannot be used anyway', async () => {
      await expect(downLinks.removeOf([randomUUID()])).resolves.toBeUndefined();
    });
  });
});
