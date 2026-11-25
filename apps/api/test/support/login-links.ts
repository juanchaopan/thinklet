import { createHash } from 'node:crypto';
import { createClient } from 'redis';

// Helpers for tests of the children's login links, which live in Redis under
// the keys `.docs/design/data.md` names ("Redis 里的"): what Redis holds of a
// link, and a link run out of its time as ten minutes passing would leave it.

/** A client of the Redis at the address, not connected yet. */
const clientOf = (url: string) => createClient({ url });

type RedisClient = ReturnType<typeof clientOf>;

/** The SHA-256 of a token in hex, as the api keys a link by. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The keys of a login link and of its child's current link. */
export function loginLinkKeyNames(link: { token: string; id: string; childId: string }) {
  return {
    token: `login-link:${sha256(link.token)}`,
    state: `login-link-status:${link.id}`,
    current: `child-login-link:${link.childId}`,
  };
}

/** Runs the commands on a connection of the test's own to the Redis at the address. */
export async function withRedis<T>(
  url: string,
  commands: (client: RedisClient) => Promise<T>,
): Promise<T> {
  const client = clientOf(url);
  await client.connect();
  try {
    return await commands(client);
  } finally {
    client.destroy();
  }
}

/** A key as Redis holds it: its value, or null when it is not there, and its expiry time. */
export interface StoredKey {
  value: string | null;
  /** When the key expires, in Unix milliseconds; -1 for a key that never does, -2 for one not there. */
  expiresAt: number;
}

/** What Redis holds under the keys of a login link and of its child's current link. */
export async function storedLoginLink(
  url: string,
  link: { token: string; id: string; childId: string },
): Promise<{ token: StoredKey; state: StoredKey; current: StoredKey }> {
  const names = loginLinkKeyNames(link);
  return withRedis(url, async (client) => {
    const read = async (key: string): Promise<StoredKey> => ({
      value: await client.get(key),
      expiresAt: await client.pExpireTime(key),
    });
    return {
      token: await read(names.token),
      state: await read(names.state),
      current: await read(names.current),
    };
  });
}

/**
 * Lets the link's keys run out of their time now, as they would ten
 * minutes after the link was made: an expiry time in the past removes a
 * key at once, as reaching it does.
 */
export async function expireLoginLink(
  url: string,
  link: { token: string; id: string; childId: string },
): Promise<void> {
  const names = loginLinkKeyNames(link);
  await withRedis(url, async (client) => {
    const past = Date.now() - 1000;
    for (const key of [names.token, names.state, names.current]) {
      await client.pExpireAt(key, past);
    }
  });
}

/** Everything Redis holds: each key with its value and its time to live in seconds. */
export function redisContents(
  url: string,
): Promise<Array<{ key: string; value: string | null; ttl: number }>> {
  return withRedis(url, async (client) => {
    const keys = await client.keys('*');
    return Promise.all(
      keys.map(async (key) => ({ key, value: await client.get(key), ttl: await client.ttl(key) })),
    );
  });
}
