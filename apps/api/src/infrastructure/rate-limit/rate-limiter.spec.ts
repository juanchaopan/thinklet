import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MockInstance } from 'vitest';
import type { Environment } from '../config/environment.js';
import { RateLimitedError } from '../errors/api-error.js';
import type { RedisClient, RedisService } from '../redis/redis.service.js';
import {
  RELEASE_SCRIPT,
  RESERVE_SCRIPT,
  RateLimiter,
  secondsLeft,
  type RateCounter,
} from './rate-limiter.js';

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
  count: number;
  expiresAt: number;
}

/**
 * Redis in memory running the limiter's two scripts as Redis runs them,
 * each in one step, its keys expiring on the clock. The scripts themselves
 * run on Redis in the integration tests.
 */
class MemoryRedis {
  readonly entries = new Map<string, Entry>();

  eval(script: string, options: { keys: string[]; arguments?: string[] }): Promise<number> {
    if (script === RESERVE_SCRIPT) {
      return Promise.resolve(this.reserve(options.keys, options.arguments ?? []));
    }
    if (script === RELEASE_SCRIPT) {
      this.release(options.keys);
      return Promise.resolve(1);
    }
    return Promise.reject(new Error('unknown script'));
  }

  counts(): number[] {
    return [...this.entries.keys()].map((key) => this.live(key)?.count ?? 0);
  }

  private reserve(keys: string[], limitsAndWindows: string[]): number {
    let wait = 0;
    keys.forEach((key, index) => {
      const entry = this.live(key) ?? {
        count: 0,
        expiresAt: Date.now() + Number(limitsAndWindows[2 * index + 1]),
      };
      entry.count += 1;
      this.entries.set(key, entry);
      const left = entry.expiresAt - Date.now();
      if (entry.count > Number(limitsAndWindows[2 * index]) && left > wait) {
        wait = left;
      }
    });
    if (wait > 0) {
      this.giveBack(keys);
    }
    return wait;
  }

  private release(keys: string[]): void {
    this.giveBack(keys.filter((key) => this.live(key) !== undefined));
  }

  private giveBack(keys: string[]): void {
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry !== undefined) {
        entry.count -= 1;
        if (entry.count <= 0) {
          this.entries.delete(key);
        }
      }
    }
  }

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt <= Date.now()) {
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

/** An attempt that stays in flight until it is settled. */
function heldAttempt() {
  let settle: (outcome: 'success' | 'failure') => void = () => {};
  const made = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        settle = (outcome) => {
          if (outcome === 'success') {
            resolve('signed in');
          } else {
            reject(new WrongPassword());
          }
        };
      }),
  );
  return { made, settle: (outcome: 'success' | 'failure') => settle(outcome) };
}

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

    expect(memory.counts()).toEqual([2, 2]);
  });

  it('does not count an error that is not a failure', async () => {
    const { limiter, memory } = createLimiter();
    const broken = () => Promise.reject(new Error('the database is down'));

    await expect(limiter.attempt(CLIENT_IP, [PER_CHILD], broken, isWrongPassword)).rejects.toThrow(
      'the database is down',
    );

    expect(memory.entries.size).toBe(0);
  });

  it('keeps a success from giving back the failures counted before it', async () => {
    const { limiter, memory } = createLimiter();
    await failTimes(limiter, 2);

    await limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], succeeds, isWrongPassword);

    expect(memory.counts()).toEqual([2, 2]);
  });

  it('refuses the attempt after the limit with the seconds left of the window, without making it or counting it', async () => {
    const { limiter, memory } = createLimiter();
    await failTimes(limiter, PER_CHILD.limit);
    vi.advanceTimersByTime(100_500);
    const attempt = vi.fn(succeeds);

    const refusal = limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], attempt, isWrongPassword);

    await expect(refusal).rejects.toBeInstanceOf(RateLimitedError);
    await expect(refusal).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 800 });
    expect(attempt).not.toHaveBeenCalled();
    expect(memory.counts()).toEqual([PER_CHILD.limit, PER_CHILD.limit]);
  });

  it('makes no more attempts at the same time than the limit lets fail', async () => {
    const { limiter, memory } = createLimiter();
    const held = Array.from({ length: PER_CHILD.limit + 4 }, heldAttempt);

    const outcomes = held.map(({ made }) =>
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], made, isWrongPassword).then(
        () => 'signed in',
        (error: unknown) => (error instanceof RateLimitedError ? 'refused' : 'failed'),
      ),
    );
    await vi.waitFor(() => {
      expect(held.filter(({ made }) => made.mock.calls.length > 0)).toHaveLength(PER_CHILD.limit);
    });
    held.forEach(({ settle }) => settle('failure'));

    expect((await Promise.all(outcomes)).sort()).toEqual([
      ...Array<string>(PER_CHILD.limit).fill('failed'),
      ...Array<string>(4).fill('refused'),
    ]);
    expect(memory.counts()).toEqual([PER_CHILD.limit, PER_CHILD.limit]);
  });

  it('gives back the counts of attempts in flight that succeed', async () => {
    const { limiter, memory } = createLimiter();
    const held = Array.from({ length: PER_CHILD.limit }, heldAttempt);
    const outcomes = held.map(({ made }) =>
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], made, isWrongPassword),
    );
    await vi.waitFor(() => {
      expect(held.every(({ made }) => made.mock.calls.length > 0)).toBe(true);
    });

    held.forEach(({ settle }) => settle('success'));
    await Promise.all(outcomes);

    expect(memory.entries.size).toBe(0);
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

  it('makes the attempt uncounted when Redis fails, logging the failure without the address', async () => {
    const { limiter, redis } = createLimiter();
    redis.failing = true;

    await expect(
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], succeeds, isWrongPassword),
    ).resolves.toBe('signed in');
    await expect(
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], fails, isWrongPassword),
    ).rejects.toThrow(WrongPassword);

    expect(redis.run).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'Redis is not reachable' } },
      'Rate limit not applied: Redis failed',
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain(CLIENT_IP);
  });

  it('answers a success when Redis fails before its reservation is given back, logging it', async () => {
    const { limiter, memory, redis } = createLimiter();
    const failsRedisThenSucceeds = () => {
      redis.failing = true;
      return succeeds();
    };

    await expect(
      limiter.attempt(CLIENT_IP, [PER_CHILD, PER_SOURCE], failsRedisThenSucceeds, isWrongPassword),
    ).resolves.toBe('signed in');

    expect(memory.counts()).toEqual([1, 1]);
    expect(logged).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'Redis is not reachable' } },
      'Reservation not given back: Redis failed',
    );
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
