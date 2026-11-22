import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';

const deriveArgon2 = promisify(argon2);

const ALGORITHM = 'argon2id';
/** Argon2 version 1.3, the only one Node implements. */
const VERSION = 19;
const SALT_BYTES = 16;

/** The cost of a new hash: OWASP's minimum for argon2id (19 MiB, 2 passes, 1 lane). */
export const PASSWORD_HASH_COST = {
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;

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

const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/** Unpadded base64 decoded into bytes, only when it is their canonical encoding. */
function decode(text: string): Buffer {
  const bytes = Buffer.from(text, 'base64');
  if (encode(bytes) !== text) {
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
 */
@Injectable()
export class PasswordHasher {
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
   * in constant time. Rejects with PasswordHashFormatError when the stored
   * value is not a hash this api writes, so broken data is not mistaken for
   * a wrong password.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const { memory, passes, parallelism, salt, hash } = parse(stored);
    const candidate = await deriveArgon2(ALGORITHM, {
      message: password,
      nonce: salt,
      memory,
      passes,
      parallelism,
      tagLength: hash.length,
    });
    return timingSafeEqual(candidate, hash);
  }
}
