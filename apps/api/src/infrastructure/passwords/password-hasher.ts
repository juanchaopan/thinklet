import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { withinChildPasswordLimits } from '@thinklet/contracts';
import { decodeCanonicalBase64, encodeBase64 } from '../encoding/canonical-base64.js';

const deriveArgon2 = promisify(argon2);

const ALGORITHM = 'argon2id';
/** Argon2 version 1.3, the only one Node implements. */
const VERSION = 19;
const SALT_BYTES = 16;

/** The cost of a new hash: OWASP's minimum for argon2id (19 MiB, 2 passes, 1 lane). */
const PASSWORD_HASH_COST = {
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;

/** The bytes of the random password the stand-in hash is made from. */
const STAND_IN_PASSWORD_BYTES = 32;

/** What a stored hash says it was made with, and the hash itself. */
interface StoredHash {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
}

/** `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>`, salt and hash in unpadded base64. */
const PHC_FORMAT =
  /^\$argon2id\$v=19\$m=([1-9]\d{0,9}),t=([1-9]\d{0,9}),p=([1-9]\d{0,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** A stored hash this api cannot read, which means the stored data is broken. */
export class PasswordHashFormatError extends Error {
  override readonly name = 'PasswordHashFormatError';

  constructor() {
    super('The stored password hash is not an argon2id hash in the PHC format');
  }
}

const encode = (bytes: Buffer) => encodeBase64(bytes, 'base64-unpadded');

/** Unpadded base64 decoded into bytes, only when it is their canonical encoding. */
function decode(text: string): Buffer {
  const bytes = decodeCanonicalBase64(text, 'base64-unpadded');
  if (bytes === undefined) {
    throw new PasswordHashFormatError();
  }
  return bytes;
}

function parse(stored: string): StoredHash {
  const match = PHC_FORMAT.exec(stored);
  if (match === null) {
    throw new PasswordHashFormatError();
  }
  const [, memory = '', passes = '', parallelism = '', salt = '', hash = ''] = match;
  return {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    salt: decode(salt),
    hash: decode(hash),
  };
}

/**
 * Hashes and checks passwords with Node's own argon2id (decision 0033). A
 * hash is stored as a PHC string that carries its parameters and salt, so
 * a check always uses the cost the hash was made with and the cost of new
 * hashes can be raised later without breaking the old ones. Both run off
 * the event loop. The password itself is never kept or logged.
 *
 * A password longer than a child's password may be (32 characters, 128
 * bytes) never reaches argon2: it cannot be anyone's password, so it is
 * refused at once, and the cost of a check does not grow with what a
 * request sends (`.docs/design/rules.md`, "限流").
 */
@Injectable()
export class PasswordHasher {
  /**
   * A hash of a random password with the cost of every new hash, checked
   * when there is no hash to check. It is made on first use; a failed
   * attempt is forgotten, so the next check makes it afresh.
   */
  private standIn: Promise<string> | undefined;

  /** The PHC string of the password with a new random 16-byte salt. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const { memory, passes, parallelism, tagLength } = PASSWORD_HASH_COST;
    const hash = await deriveArgon2(ALGORITHM, {
      message: password,
      nonce: salt,
      memory,
      passes,
      parallelism,
      tagLength,
    });
    return `$${ALGORITHM}$v=${VERSION}$m=${memory},t=${passes},p=${parallelism}$${encode(salt)}$${encode(hash)}`;
  }

  /**
   * Whether the password is the one the stored hash was made from, compared
   * in constant time. With no stored hash (no such account, or no password
   * set yet) the password is checked against the stand-in hash and refused,
   * so the time taken does not tell which was missing. Rejects with
   * PasswordHashFormatError when the stored value is not a hash this api
   * writes, so broken data is not mistaken for a wrong password.
   */
  async verify(password: string, stored: string | null): Promise<boolean> {
    if (!withinChildPasswordLimits(password)) {
      return false;
    }
    const { memory, passes, parallelism, salt, hash } = parse(stored ?? (await this.standInHash()));
    const candidate = await deriveArgon2(ALGORITHM, {
      message: password,
      nonce: salt,
      memory,
      passes,
      parallelism,
      tagLength: hash.length,
    });
    return timingSafeEqual(candidate, hash) && stored !== null;
  }

  /** The stand-in hash, made on first use and made again after an attempt that failed. */
  private standInHash(): Promise<string> {
    this.standIn ??= this.hash(randomBytes(STAND_IN_PASSWORD_BYTES).toString('base64url')).catch(
      (error: unknown) => {
        this.standIn = undefined;
        throw error;
      },
    );
    return this.standIn;
  }
}
