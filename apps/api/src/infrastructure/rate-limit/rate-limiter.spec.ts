import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MockInstance } from 'vitest';
import type { Environment } from '../config/environment.js';
import { RateLimitedError } from '../errors/api-error.js';
import type { RedisClient, RedisService } from '../redis/redis.service.js';
import { RateLimiter, secondsLeft, type RateCounter } from './rate-limiter.js';

const NOW = new Date('2026-11-24T09:00:00.000Z');
/** A documentation address (RFC 5737), and another one. */
const CLIENT_IP = '203.0.113.7';
const OTHER_IP = '198.51.100.20';

const PER_CHILD: RateCounter = {
  name: 'child-login',
  subject: 'child-1',
  limit: 3,
  windowSeconds: 900,
};
const PER_SOURCE: RateCounter = { name: 'child-login', limit: 5, windowSeconds: 900 };

interface Entry {
  value: string;
  expiresAt: number | undefined;
}

/**
 * Redis in memory with the commands the limiter uses, its keys expiring on
 * the clock as Redis expires them.
 */
class MemoryRedis {
  readonly entries = new Map<string, Entry>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  pTTL(key: string): Promise<number> {
    const entry = this.live(key);
    if (entry === undefined) {
      return Promise.resolve(-2);
    }
    return Promise.resolve(entry.expiresAt === undefined ? -1 : entry.expiresAt - Date.now());
  }

  multi() {
    const steps: Array<() => unknown> = [];
    const transaction = {
      set: (
        key: string,
        value: string,
        options: { expiration: { type: 'EX'; value: number }; condition: 'NX' },
      ) => {
        steps.push(() => {
          if (this.live(key) !== undefined) {
            return null;
          }
          const expiresAt = Date.now() + options.expiration.value * 1000;
          this.entries.set(key, { value, expiresAt });
          return 'OK';
        });
        return transaction;
      },
      incr: (key: string) => {
        steps.push(() => {
          const entry = this.live(key) ?? { value: '0', expiresAt: undefined };
          const value = String(Number(entry.value) + 1);
          this.entries.set(key, { ...entry, value });
          return Number(value);
        });
        return transaction;
      },
      exec: () => Promise.resolve(steps.map((step) => step())),
    };
    return transaction;
  }

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
}

/** A limiter over Redis in memory, or over a Redis whose commands fail. */
function createLimiter(masterKey = randomBytes(32)) {
  const memory = new MemoryRedis();
  const redis = {
    failing: false,
    run: vi.fn(<T>(commands: (client: RedisClient) => Promise<T>): Promise<T> => {
      if (redis.failing) {
        return Promise.reject(new Error('Redis is not reachable'));
      }
      return commands(memory as unknown as RedisClient);
    }),
  };
  const config = { get: () => masterKey } as unknown as ConfigService<Environment, true>;
  const limiter = new RateLimiter(config, redis as unknown as RedisService);
  return { limiter, memory, redis };
}

class WrongPassword extends Error {}

const isWrongPassword = (error: unknown) => error instanceof WrongPassword;
const fails = () => Promise.reject(new WrongPassword());
const succeeds = () => Promise.resolve('signed in');

describe('RateLimiter', () => {
  let logged: MockInstance<Logger['error']>;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Makes `times` failed attempts of the client on the counters. */
  async function failTimes(
    limiter: RateLimiter,
    times: number,
    counters: readonly RateCounter[] = [PER_CHILD, PER_SOURCE],
    clientIp = CLIENT_IP,
  ): Promise<void> {
    for (let attempt = 0; attempt < times; attempt += 1) {
      await expect(limiter.attempt(clientIp, counters, fails, isWrongPassword)).rejects.toThrow(
        WrongPassword,
      );
    }
  }

  it('makes the attempt and counts nothing when it succeeds', async () => {
    const { limiter, memory } = createLimiter();

    await expect(
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], succeeds, isWrongPassword),
    ).resolves.toBe('signed in');

    expect(memory.entries.size).toBe(0);
  });

  it('counts a failure in every counter and throws it on', async () => {
    const { limiter, memory } = createLimiter();

    await failTimes(limiter, 2);

    expect([...memory.entries.values()].map((entry) => entry.value)).toEqual(['2', '2']);
  });

  it('does not count an error that is not a failure', async () => {
    const { limiter, memory } = createLimiter();
    const broken = () => Promise.reject(new Error('the database is down'));

    await expect(limiter.attempt(CLIENT_IP, [PER_CHILD], broken, isWrongPassword)).rejects.toThrow(
      'the database is down',
    );

    expect(memory.entries.size).toBe(0);
  });

  it('refuses the attempt after the limit with the seconds left of the window, without making it', async () => {
    const { limiter } = createLimiter();
    await failTimes(limiter, PER_CHILD.limit);
    vi.advanceTimersByTime(100_500);
    const attempt = vi.fn(succeeds);

    const refusal = limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], attempt, isWrongPassword);

    await expect(refusal).rejects.toBeInstanceOf(RateLimitedError);
    await expect(refusal).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 800 });
    expect(attempt).not.toHaveBeenCalled();
  });

  it('lets the source try again once the window from its first failure is over', async () => {
    const { limiter } = createLimiter();
    await failTimes(limiter, 1);
    vi.advanceTimersByTime(600_000);
    await failTimes(limiter, PER_CHILD.limit - 1);
    vi.advanceTimersByTime(300_000);

    await expect(
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], succeeds, isWrongPassword),
    ).resolves.toBe('signed in');
  });

  it('refuses when the counter of the source alone is at its limit, whatever the subject', async () => {
    const { limiter } = createLimiter();
    for (const subject of ['child-1', 'child-2', 'child-3', 'child-4', 'child-5']) {
      await failTimes(limiter, 1, [{ ...PER_CHILD, subject }, PER_SOURCE]);
    }

    await expect(
      limiter.attempt(
        CLIENT_IP,
        [{ ...PER_CHILD, subject: 'child-6' }, PER_SOURCE],
        succeeds,
        isWrongPassword,
      ),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('keeps the counts of another subject and another source apart', async () => {
    const { limiter } = createLimiter();
    await failTimes(limiter, PER_CHILD.limit);

    await expect(
      limiter.attempt(
        CLIENT_IP,
        [{ ...PER_CHILD, subject: 'child-2' }, PER_SOURCE],
        succeeds,
        isWrongPassword,
      ),
    ).resolves.toBe('signed in');
    await expect(
      limiter.attempt(OTHER_IP, [PER_CHILD, PER_SOURCE], succeeds, isWrongPassword),
    ).resolves.toBe('signed in');
  });

  it('keys a counter by the HMAC of the address in hex, never the address itself', async () => {
    const { limiter, memory } = createLimiter();

    await failTimes(limiter, 1);

    const source = limiter.digest(CLIENT_IP);
    expect(source).toMatch(/^[0-9a-f]{64}$/);
    expect([...memory.entries.keys()].sort()).toEqual([
      `rate:child-login:${source}`,
      `rate:child-login:${source}:child-1`,
    ]);
    expect(JSON.stringify([...memory.entries])).not.toContain(CLIENT_IP);
  });

  it('derives its key from the master key, so another master key gives other digests', () => {
    const masterKey = randomBytes(32);

    expect(createLimiter(masterKey).limiter.digest(CLIENT_IP)).toBe(
      createLimiter(masterKey).limiter.digest(CLIENT_IP),
    );
    expect(createLimiter().limiter.digest(CLIENT_IP)).not.toBe(
      createLimiter().limiter.digest(CLIENT_IP),
    );
  });

  it('digests a list of values so that no two lists run into each other', () => {
    const { limiter } = createLimiter();

    expect(limiter.digest('7KQ4MZ', 'xiaomi')).not.toBe(limiter.digest('7KQ4MZx', 'iaomi'));
    expect(limiter.digest('a,b')).not.toBe(limiter.digest('a', 'b'));
  });

  it('makes an attempt without a client address uncounted and logs it without Redis', async () => {
    const { limiter, redis } = createLimiter();

    await expect(limiter.attempt(undefined, [PER_CHILD], fails, isWrongPassword)).rejects.toThrow(
      WrongPassword,
    );

    expect(redis.run).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      'Rate limit not applied: the request has no client IP address',
    );
  });

  it('makes the attempt when Redis fails, logging the failure without the address', async () => {
    const { limiter, redis } = createLimiter();
    redis.failing = true;

    await expect(
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], succeeds, isWrongPassword),
    ).resolves.toBe('signed in');
    await expect(
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], fails, isWrongPassword),
    ).rejects.toThrow(WrongPassword);

    expect(logged).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'Redis is not reachable' } },
      'Rate limit not applied: Redis failed',
    );
    expect(logged).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'Redis is not reachable' } },
      'Failure not counted: Redis failed',
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain(CLIENT_IP);
  });
});

describe('secondsLeft', () => {
  it.each([
    [800_000, 800],
    [799_001, 800],
    [1, 1],
    [0, 1],
  ])('makes %d ms left %d seconds', (timeToLiveMs, seconds) => {
    expect(secondsLeft(timeToLiveMs)).toBe(seconds);
  });
});
