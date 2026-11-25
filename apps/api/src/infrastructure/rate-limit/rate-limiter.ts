import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { subkey } from '../child-data/child-data-cipher.js';
import type { Environment } from '../config/environment.js';
import { RateLimitedError } from '../errors/api-error.js';
import { describeError } from '../logging/describe-error.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * The HKDF label of the key the rate limits' keys are computed with, so it
 * never doubles as the child data's encryption or lookup key.
 */
const KEY_INFO = 'thinklet rate limit keys v1';

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

/** Whether a failure an attempt threw counts against its source. */
export type FailurePredicate = (error: unknown) => boolean;

/** The seconds left of a window from its time to live in milliseconds, whole seconds up. */
export function secondsLeft(timeToLiveMs: number): number {
  return Math.max(1, Math.ceil(timeToLiveMs / 1000));
}

/**
 * Reserves one count in every counter of an attempt, in one step so that
 * attempts made at the same time each see the others' reservations. A key
 * without a time to live, which a new key is, gets the window as its time
 * to live. When a count goes over its counter's limit, every count just
 * reserved is given back and the script returns the most milliseconds left
 * of the windows over their limits; otherwise it returns 0. A key given
 * back to 0 is deleted, so a window starts with an attempt that counts.
 *
 * KEYS: the counters' keys. ARGV: for each key in order, its limit and its
 * window in milliseconds.
 */
export const RESERVE_SCRIPT = `
local wait = 0
for index, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  local left = redis.call('PTTL', key)
  if left < 0 then
    left = tonumber(ARGV[2 * index])
    redis.call('PEXPIRE', key, left)
  end
  if count > tonumber(ARGV[2 * index - 1]) and left > wait then
    wait = left
  end
end
if wait > 0 then
  for _, key in ipairs(KEYS) do
    if redis.call('DECR', key) <= 0 then
      redis.call('DEL', key)
    end
  end
end
return wait
`;

/**
 * Gives back one reserved count in every counter that is still there; a
 * key whose window ended meanwhile is left gone, and a key given back to 0
 * is deleted.
 *
 * KEYS: the counters' keys.
 */
export const RELEASE_SCRIPT = `
for _, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 and redis.call('DECR', key) <= 0 then
    redis.call('DEL', key)
  end
end
return 1
`;

/**
 * Limits the failures of a request's source (decision 0039): only failed
 * attempts are counted, each in every one of its counters, and once one
 * counter is at its limit the next attempt is refused with 429
 * `rate_limited` before it is made, with the seconds left of that window.
 *
 * Every attempt reserves its count in every counter before it is made and
 * gives the reservation back unless it fails, so attempts made at the same
 * time cannot all pass a counter one below its limit: at most the limit's
 * number of them are in flight or failed in a window.
 *
 * The counts live in Redis, each key living for its window from the
 * first attempt counted in it. The source in a key is the HMAC-SHA256 of
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
    this.key = subkey(config.get('CHILD_DATA_KEY', { infer: true }), KEY_INFO);
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
   * `isFailure` accepts stays counted in every counter and is thrown on.
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
    const keys = counters.map((counter) => keyOf(counter, source));
    const reserved = await this.reserve(keys, counters);
    let failed = false;
    try {
      return await attempt();
    } catch (error) {
      failed = isFailure(error);
      throw error;
    } finally {
      if (reserved && !failed) {
        await this.release(keys);
      }
    }
  }

  /**
   * Reserves a count in every counter: true when it did, false when Redis
   * failed and the attempt goes uncounted. Throws RateLimitedError, having
   * reserved nothing, when a counter is at its limit.
   */
  private async reserve(
    keys: readonly string[],
    counters: readonly RateCounter[],
  ): Promise<boolean> {
    let waitMs: unknown;
    try {
      waitMs = await this.redis.run((client) =>
        client.eval(RESERVE_SCRIPT, {
          keys: [...keys],
          arguments: counters.flatMap(({ limit, windowSeconds }) => [
            String(limit),
            String(windowSeconds * 1000),
          ]),
        }),
      );
    } catch (error) {
      this.logger.error({ error: describeError(error) }, 'Rate limit not applied: Redis failed');
      return false;
    }
    if (typeof waitMs === 'number' && waitMs > 0) {
      throw new RateLimitedError(secondsLeft(waitMs));
    }
    return true;
  }

  /** Gives back the counts an attempt that did not fail reserved. */
  private async release(keys: readonly string[]): Promise<void> {
    try {
      await this.redis.run((client) => client.eval(RELEASE_SCRIPT, { keys: [...keys] }));
    } catch (error) {
      this.logger.error(
        { error: describeError(error) },
        'Reservation not given back: Redis failed',
      );
    }
  }
}

/** The Redis key of a counter for a source. */
function keyOf({ name, subject }: RateCounter, source: string): string {
  return subject === undefined ? `rate:${name}:${source}` : `rate:${name}:${source}:${subject}`;
}
