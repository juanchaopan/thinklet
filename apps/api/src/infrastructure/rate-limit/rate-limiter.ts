import { createHmac, hkdfSync } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { RateLimitedError } from '../errors/api-error.js';
import { describeError } from '../logging/describe-error.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * The HKDF label of the key the rate limits' keys are computed with, so it
 * never doubles as the child data's encryption or lookup key.
 */
const KEY_INFO = 'thinklet rate limit keys v1';
const KEY_BYTES = 32;

/**
 * One count of failures by a request's source in a window: its key in
 * Redis is `rate:<name>:<source>`, or `rate:<name>:<source>:<subject>`
 * when it counts the source's failures on one subject, such as a child.
 * Once `limit` failures are counted, the source is refused until the
 * window, which starts at its first failure, is over.
 */
export interface RateCounter {
  name: string;
  /** What the count is kept per besides the source; never personal data in clear. */
  subject?: string;
  limit: number;
  windowSeconds: number;
}

/** A counter with its key in Redis. */
interface KeyedCounter extends RateCounter {
  key: string;
}

/** Whether a failure an attempt threw counts against its source. */
export type FailurePredicate = (error: unknown) => boolean;

/** The seconds left of a window from its time to live in milliseconds, whole seconds up. */
export function secondsLeft(timeToLiveMs: number): number {
  return Math.max(1, Math.ceil(timeToLiveMs / 1000));
}

/**
 * Limits the failures of a request's source (decision 0039): only failed
 * attempts are counted, each in every one of its counters, and once one
 * counter is at its limit the next attempt is refused with 429
 * `rate_limited` before it is made, with the seconds left of that window.
 *
 * The counts live in Redis, each key living for its window from the
 * first failure counted in it. The source in a key is the HMAC-SHA256 of
 * the client's IP address under a key derived from CHILD_DATA_KEY with
 * HKDF, written in hex, so Redis never holds the address. A rate limit is
 * one layer of protection: when Redis fails, or the request carries no
 * client IP address, the attempt is made uncounted and an error is logged
 * without the address.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);
  private readonly key: Buffer;

  constructor(
    config: ConfigService<Environment, true>,
    private readonly redis: RedisService,
  ) {
    const masterKey = config.get('CHILD_DATA_KEY', { infer: true });
    this.key = Buffer.from(hkdfSync('sha256', masterKey, '', KEY_INFO, KEY_BYTES));
  }

  /**
   * The HMAC-SHA256 in hex of the values, encoded as a JSON array so that
   * no set of values can run into another; a subject made of what was
   * typed, such as a family code and an account, goes into a key this way.
   */
  digest(...values: string[]): string {
    return createHmac('sha256', this.key).update(JSON.stringify(values)).digest('hex');
  }

  /**
   * Makes the attempt for the client unless one of the counters is at its
   * limit, which is a RateLimitedError; a failure the attempt throws that
   * `isFailure` accepts is counted in every counter, then thrown on.
   */
  async attempt<T>(
    clientIp: string | undefined,
    counters: readonly RateCounter[],
    attempt: () => Promise<T>,
    isFailure: FailurePredicate,
  ): Promise<T> {
    if (clientIp === undefined) {
      this.logger.error('Rate limit not applied: the request has no client IP address');
      return attempt();
    }
    const source = this.digest(clientIp);
    const keyed = counters.map((counter) => ({ ...counter, key: keyOf(counter, source) }));
    await this.refuseOverLimit(keyed);
    try {
      return await attempt();
    } catch (error) {
      if (isFailure(error)) {
        await this.countFailure(keyed);
      }
      throw error;
    }
  }

  /** Throws RateLimitedError when a counter is at its limit, with the most seconds left of any. */
  private async refuseOverLimit(counters: readonly KeyedCounter[]): Promise<void> {
    let states: Array<{ count: number; timeToLiveMs: number }>;
    try {
      states = await this.redis.run((client) =>
        Promise.all(
          counters.map(async ({ key }) => {
            const [count, timeToLiveMs] = await Promise.all([client.get(key), client.pTTL(key)]);
            return { count: Number(count ?? 0), timeToLiveMs };
          }),
        ),
      );
    } catch (error) {
      this.logger.error({ error: describeError(error) }, 'Rate limit not applied: Redis failed');
      return;
    }
    // A key without a time to live (-1) or gone meanwhile (-2) limits nothing.
    const waits = states.flatMap(({ count, timeToLiveMs }, index) =>
      count >= (counters[index]?.limit ?? Infinity) && timeToLiveMs > 0
        ? [secondsLeft(timeToLiveMs)]
        : [],
    );
    if (waits.length > 0) {
      throw new RateLimitedError(Math.max(...waits));
    }
  }

  /**
   * Counts one failure in every counter in one transaction: a key new to
   * the window is created at 0 with the window as its time to live, then
   * incremented, which keeps that time to live.
   */
  private async countFailure(counters: readonly KeyedCounter[]): Promise<void> {
    try {
      await this.redis.run((client) => {
        const transaction = client.multi();
        for (const { key, windowSeconds } of counters) {
          transaction
            .set(key, '0', { expiration: { type: 'EX', value: windowSeconds }, condition: 'NX' })
            .incr(key);
        }
        return transaction.exec();
      });
    } catch (error) {
      this.logger.error({ error: describeError(error) }, 'Failure not counted: Redis failed');
    }
  }
}

/** The Redis key of a counter for a source. */
function keyOf({ name, subject }: RateCounter, source: string): string {
  return subject === undefined ? `rate:${name}:${source}` : `rate:${name}:${source}:${subject}`;
}
