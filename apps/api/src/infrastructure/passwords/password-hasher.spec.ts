import { argon2Sync, randomBytes } from 'node:crypto';
import { PasswordHashFormatError, PasswordHasher } from './password-hasher.js';

const hasher = new PasswordHasher();

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

describe('PasswordHasher', () => {
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
});
