import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { describeError } from '../../infrastructure/logging/describe-error.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';

/** How long a login link works after it is made (`.docs/design/rules.md`, "登录二维码"). */
export const LOGIN_LINK_LIFETIME_MS = 10 * 60 * 1000;

/** The value of `login-link:<token hash>`: the link a token opens (`.docs/design/data.md`, "Redis 里的"). */
const linkValueSchema = z.strictObject({ linkId: z.string(), childId: z.string() });

/**
 * The value of `login-link-status:<link id>`: what a parent reads of a
 * link. Once the key is gone the link is `expired`.
 */
const stateValueSchema = z.strictObject({
  childId: z.string(),
  status: z.enum(['active', 'used', 'revoked']),
  expiresAt: z.iso.datetime(),
});

/**
 * The value of `child-login-link:<child id>`: the child's current link,
 * with its token's hash, so a newer link or the child's deletion finds the
 * link's token key as well as its state key.
 */
const currentValueSchema = z.strictObject({ linkId: z.string(), tokenHash: z.string() });

/** The state of a login link as its state key holds it. */
export type LoginLinkState = z.infer<typeof stateValueSchema>;

/** A new login link of a child, its token known only by its hash. */
export interface NewLoginLink {
  linkId: string;
  childId: string;
  tokenHash: string;
  expiresAt: Date;
}

/** A login link that can be used: its token key is there, so it is neither used, revoked nor expired. */
export interface ActiveLoginLink {
  linkId: string;
  childId: string;
  tokenHash: string;
  /** When the link expires, as an ISO date-time. */
  expiresAt: string;
}

const tokenKey = (tokenHash: string) => `login-link:${tokenHash}`;
const stateKey = (linkId: string) => `login-link-status:${linkId}`;
const currentKey = (childId: string) => `child-login-link:${childId}`;

/**
 * Stores a new link and makes it the child's current one, all to expire at
 * the link's expiry time. When the child had a link, its token key is
 * deleted, so it can no longer be used, and its state becomes `revoked`
 * if it is still the `active` state read before the script; a link used
 * meanwhile keeps its `used`.
 *
 * KEYS: the child's current-link key, the new token key, the new state
 * key, then, when the child had a link, its token key and its state key.
 * ARGV: the new current-link value, token value and state value, the
 * expiry time in Unix milliseconds, then, when the child had a link, its
 * active state as read (empty when it was not active) and its revoked one.
 */
const CREATE_SCRIPT = `
if #KEYS == 5 then
  redis.call('DEL', KEYS[4])
  if ARGV[5] ~= '' and redis.call('GET', KEYS[5]) == ARGV[5] then
    redis.call('SET', KEYS[5], ARGV[6], 'KEEPTTL')
  end
end
redis.call('SET', KEYS[2], ARGV[2], 'PXAT', ARGV[4])
redis.call('SET', KEYS[3], ARGV[3], 'PXAT', ARGV[4])
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[4])
return 1
`;

/**
 * Uses a link: deletes its token key and, only when there was one to
 * delete, sets its state to `used`, keeping the state's expiry. Returns 1
 * when this script used the link and 0 when it was gone already, so of
 * two uses at once only one gets 1.
 *
 * KEYS: the token key, the state key. ARGV: the used state.
 */
const TAKE_SCRIPT = `
if redis.call('DEL', KEYS[1]) == 0 then
  return 0
end
redis.call('SET', KEYS[2], ARGV[1], 'XX', 'KEEPTTL')
return 1
`;

/** The value parsed with the schema, or undefined for a key that is not there. */
function parsed<T>(schema: z.ZodType<T>, value: string | null): T | undefined {
  return value === null ? undefined : schema.parse(JSON.parse(value));
}

/**
 * The children's login links in Redis (decision 0033; `.docs/design/data.md`,
 * "Redis 里的"): a token key by the SHA-256 of the token, never the token
 * itself, a state key by the link's id for the parents, and a key of each
 * child's current link. All three expire with the link, ten minutes after
 * it is made, and are not migrated.
 *
 * A link can be used while its token key is there. Using it deletes that
 * key in the same script that marks it used, so it works once; a newer
 * link of the child deletes the older token key in the script that stores
 * the newer one. The api never runs two makings of one child's links at
 * once: it makes a link holding the child's row lock.
 *
 * Every command goes through RedisService; while Redis cannot be reached
 * they fail, and a link can neither be made nor used.
 */
@Injectable()
export class LoginLinks {
  private readonly logger = new Logger(LoginLinks.name);

  constructor(private readonly redis: RedisService) {}

  /** Stores the new link as the child's current one, which leaves the child's older link unusable. */
  async create(link: NewLoginLink): Promise<void> {
    const expiresAt = link.expiresAt.toISOString();
    await this.redis.run(async (client) => {
      const current = parsed(currentValueSchema, await client.get(currentKey(link.childId)));
      const keys = [currentKey(link.childId), tokenKey(link.tokenHash), stateKey(link.linkId)];
      const values = [
        JSON.stringify({ linkId: link.linkId, tokenHash: link.tokenHash }),
        JSON.stringify({ linkId: link.linkId, childId: link.childId }),
        JSON.stringify({ childId: link.childId, status: 'active', expiresAt }),
        String(link.expiresAt.getTime()),
      ];
      if (current !== undefined) {
        const read = await client.get(stateKey(current.linkId));
        const state = parsed(stateValueSchema, read);
        const active = state?.status === 'active' && read !== null;
        keys.push(tokenKey(current.tokenHash), stateKey(current.linkId));
        values.push(
          active ? read : '',
          active ? JSON.stringify({ ...state, status: 'revoked' }) : '',
        );
      }
      await client.eval(CREATE_SCRIPT, { keys, arguments: values });
    });
  }

  /** The link the token's hash opens while it can be used, or undefined. */
  async find(tokenHash: string): Promise<ActiveLoginLink | undefined> {
    return this.redis.run(async (client) => {
      const link = parsed(linkValueSchema, await client.get(tokenKey(tokenHash)));
      if (link === undefined) {
        return undefined;
      }
      const state = parsed(stateValueSchema, await client.get(stateKey(link.linkId)));
      return state === undefined ? undefined : { ...link, tokenHash, expiresAt: state.expiresAt };
    });
  }

  /** Uses the link; false when it was used, revoked or expired before, so no login may use it. */
  async take(link: ActiveLoginLink): Promise<boolean> {
    const used = JSON.stringify({
      childId: link.childId,
      status: 'used',
      expiresAt: link.expiresAt,
    });
    const taken = await this.redis.run((client) =>
      client.eval(TAKE_SCRIPT, {
        keys: [tokenKey(link.tokenHash), stateKey(link.linkId)],
        arguments: [used],
      }),
    );
    return taken === 1;
  }

  /** The link's state, or undefined once its state key is gone: the link has expired, or never was. */
  async state(linkId: string): Promise<LoginLinkState | undefined> {
    return this.redis.run(async (client) =>
      parsed(stateValueSchema, await client.get(stateKey(linkId))),
    );
  }

  /**
   * Deletes the current link of each of the children, all three of its
   * keys, once the children are deleted. A failure is logged, not thrown:
   * a link of a deleted child cannot be used, as every use reads the child
   * from the database, and its keys expire within ten minutes.
   */
  async removeOf(childIds: readonly string[]): Promise<void> {
    if (childIds.length === 0) {
      return;
    }
    try {
      await this.redis.run(async (client) => {
        const currentKeys = childIds.map(currentKey);
        const values = await client.mGet(currentKeys);
        const linkKeys = values.flatMap((value) => {
          const current = parsed(currentValueSchema, value);
          return current === undefined
            ? []
            : [tokenKey(current.tokenHash), stateKey(current.linkId)];
        });
        await client.del([...currentKeys, ...linkKeys]);
      });
    } catch (error) {
      this.logger.error(
        { error: describeError(error) },
        "Deleted children's login links not removed: Redis failed",
      );
    }
  }
}
