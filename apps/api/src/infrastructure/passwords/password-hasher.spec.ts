import { argon2, argon2Sync, randomBytes } from 'node:crypto';
import { PasswordHashFormatError, PasswordHasher } from './password-hasher.js';

// Node's argon2 runs as itself, through a spy, so a test can tell whether a
// password reached it and can make one derivation fail.
vi.mock('node:crypto', async (importOriginal) => {
  const crypto = await importOriginal<typeof import('node:crypto')>();
  return { ...crypto, argon2: vi.fn(crypto.argon2) };
});

const argon2Calls = vi.mocked(argon2);

/** A combining accent: two bytes of UTF-8 that add no character. */
const ACUTE = String.fromCodePoint(0x301);

const unpadded = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/** A PHC string made directly with Node's argon2id, at the given cost. */
function phcWith(password: string, memory: number, passes: number, parallelism: number): string {
  const salt = randomBytes(16);
  const hash = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory,
    passes,
    parallelism,
    tagLength: 32,
  });
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${unpadded(salt)}$${unpadded(hash)}`;
}

/** Makes the next argon2 derivation fail, as when the machine runs out of memory. */
function failNextDerivation(): void {
  argon2Calls.mockImplementationOnce((_algorithm, _parameters, callback) => {
    callback(new Error('argon2 failed'), Buffer.alloc(0));
  });
}

describe('PasswordHasher', () => {
  let hasher: PasswordHasher;

  beforeEach(() => {
    hasher = new PasswordHasher();
    argon2Calls.mockClear();
  });

  it('writes an argon2id PHC string with the OWASP minimum cost, a 16-byte salt and a 32-byte hash', async () => {
    const stored = await hasher.hash('mi2016');

    const match = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([^$]+)\$([^$]+)$/.exec(stored);
    expect(match).not.toBeNull();
    expect(Buffer.from(match?.[1] ?? '', 'base64')).toHaveLength(16);
    expect(Buffer.from(match?.[2] ?? '', 'base64')).toHaveLength(32);
    expect(stored).not.toContain('mi2016');
  });

  it('uses a new salt for every hash of the same password', async () => {
    const first = await hasher.hash('mi2016');
    const second = await hasher.hash('mi2016');

    expect(first.split('$')[4]).not.toBe(second.split('$')[4]);
    expect(first).not.toBe(second);
  });

  it('accepts the password the hash was made from', async () => {
    await expect(hasher.verify('小米的密码', await hasher.hash('小米的密码'))).resolves.toBe(true);
  });

  it.each(['mi2017', 'MI2016', 'mi2016 ', ''])(
    'refuses %j for the hash of mi2016',
    async (wrong) => {
      await expect(hasher.verify(wrong, await hasher.hash('mi2016'))).resolves.toBe(false);
    },
  );

  it('checks a hash with the cost written in it, not the cost of new hashes', async () => {
    const cheaper = phcWith('mi2016', 8_192, 1, 2);

    await expect(hasher.verify('mi2016', cheaper)).resolves.toBe(true);
    await expect(hasher.verify('mi2017', cheaper)).resolves.toBe(false);
  });

  it('refuses the password when the cost written in the hash was changed', async () => {
    const stored = await hasher.hash('mi2016');

    await expect(hasher.verify('mi2016', stored.replace('t=2', 't=3'))).resolves.toBe(false);
  });

  it.each([
    ['not a hash', 'mi2016'],
    ['another algorithm', '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo'],
    ['another version', '$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo'],
    ['a missing parameter', '$argon2id$v=19$m=19456,t=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo'],
    ['padded base64', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaA=='],
    [
      'a base64 tail that is not canonical',
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaB',
    ],
  ])('fails on a stored value that is %s', async (_name, stored) => {
    await expect(hasher.verify('mi2016', stored)).rejects.toBeInstanceOf(PasswordHashFormatError);
  });

  describe('a password past the limits', () => {
    it.each([
      ['33 characters', 'a'.repeat(33)],
      ['129 bytes in one character', `a${ACUTE.repeat(64)}`],
      ['a megabyte', 'a'.repeat(1_000_000)],
    ])('refuses %s without hashing it', async (_name, password) => {
      const stored = phcWith(password, 8_192, 1, 1);
      argon2Calls.mockClear();

      await expect(hasher.verify(password, stored)).resolves.toBe(false);
      await expect(hasher.verify(password, null)).resolves.toBe(false);
      expect(argon2Calls).not.toHaveBeenCalled();
    });

    it('still checks a password of 32 characters and 128 bytes', async () => {
      const password = '😀'.repeat(32);

      await expect(hasher.verify(password, await hasher.hash(password))).resolves.toBe(true);
    });
  });

  describe('without a stored hash', () => {
    it('refuses every password after checking it against the stand-in hash', async () => {
      await expect(hasher.verify('mi2016', null)).resolves.toBe(false);
      await expect(hasher.verify('', null)).resolves.toBe(false);

      // One derivation makes the stand-in hash and one checks each password.
      expect(argon2Calls).toHaveBeenCalledTimes(3);
    });

    it('makes the stand-in hash once, with the cost of every new hash', async () => {
      await hasher.verify('mi2016', null);
      await hasher.verify('mi2017', null);

      const [making, ...checks] = argon2Calls.mock.calls.map(([, parameters]) => parameters);
      expect(making).toMatchObject({ memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 });
      expect(checks).toHaveLength(2);
      for (const check of checks) {
        expect(check).toMatchObject({ memory: 19_456, passes: 2, parallelism: 1 });
        expect(check.nonce).toEqual(making?.nonce);
      }
    });

    it('makes the stand-in hash afresh the next time after making it failed', async () => {
      failNextDerivation();

      await expect(hasher.verify('mi2016', null)).rejects.toThrow('argon2 failed');
      await expect(hasher.verify('mi2016', null)).resolves.toBe(false);
      await expect(hasher.verify('mi2017', null)).resolves.toBe(false);

      // The failed attempt, then one new stand-in hash and the two checks.
      expect(argon2Calls).toHaveBeenCalledTimes(4);
    });

    it('lets checks waiting on the same failed attempt fail, and the next one start anew', async () => {
      failNextDerivation();

      const waiting = await Promise.allSettled([
        hasher.verify('mi2016', null),
        hasher.verify('mi2017', null),
      ]);

      expect(waiting.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
      await expect(hasher.verify('mi2016', null)).resolves.toBe(false);
    });
  });
});
