import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import {
  ChildDataCipher,
  ChildDataDecryptionError,
  normaliseAccount,
} from './child-data-cipher.js';

function cipherWith(key: Buffer): ChildDataCipher {
  return new ChildDataCipher({ get: () => key } as unknown as ConfigService<Environment, true>);
}

const key = randomBytes(32);
const cipher = cipherWith(key);
const familyId = randomUUID();

/** The ciphertext with one of its four parts replaced. */
function withPart(encrypted: string, index: number, replace: (part: string) => string): string {
  const parts = encrypted.split('.');
  parts[index] = replace(parts[index] ?? '');
  return parts.join('.');
}

/** Base64url text with its first character swapped for another one. */
const flipFirst = (part: string) => `${part.startsWith('A') ? 'B' : 'A'}${part.slice(1)}`;

describe('ChildDataCipher', () => {
  describe('encrypt and decrypt', () => {
    it.each(['小米', 'xiaomi2016', 'iPad 上的 Safari', '', '😀 emoji'])(
      'give back the text %j',
      (text) => {
        expect(cipher.decrypt(cipher.encrypt(text))).toBe(text);
      },
    );

    it('write the key id, a 12-byte IV, the ciphertext and a 16-byte tag', () => {
      const [keyId, iv, ciphertext, tag, ...rest] = cipher.encrypt('小米').split('.');

      expect(keyId).toBe('v1');
      expect(Buffer.from(iv ?? '', 'base64url')).toHaveLength(12);
      expect(Buffer.from(ciphertext ?? '', 'base64url')).toHaveLength(Buffer.byteLength('小米'));
      expect(Buffer.from(tag ?? '', 'base64url')).toHaveLength(16);
      expect(rest).toEqual([]);
    });

    it('never show the text and use a new IV every time', () => {
      const first = cipher.encrypt('xiaomi');
      const second = cipher.encrypt('xiaomi');

      expect(first).not.toContain('xiaomi');
      expect(first).not.toBe(second);
      expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
    });

    it('read what another instance with the same key wrote', () => {
      expect(cipherWith(Buffer.from(key)).decrypt(cipher.encrypt('小米'))).toBe('小米');
    });
  });

  describe('decrypt refuses', () => {
    const encrypted = cipher.encrypt('小米');

    it.each<[string, string]>([
      ['a changed IV', withPart(encrypted, 1, flipFirst)],
      ['a changed ciphertext', withPart(encrypted, 2, flipFirst)],
      ['a changed tag', withPart(encrypted, 3, flipFirst)],
      ['a shortened tag', withPart(encrypted, 3, (tag) => tag.slice(0, 16))],
      ['a shortened IV', withPart(encrypted, 1, (iv) => iv.slice(0, 8))],
      ['stray characters in a part', withPart(encrypted, 2, (part) => `${part}!`)],
      ['standard base64 padding', withPart(encrypted, 3, (tag) => `${tag}==`)],
      ['an unknown key id', withPart(encrypted, 0, () => 'v2')],
      ['no key id', withPart(encrypted, 0, () => '')],
      ['too few parts', encrypted.split('.').slice(0, 3).join('.')],
      ['too many parts', `${encrypted}.AAAA`],
      ['plain text', '小米'],
      ['nothing', ''],
    ])('%s', (_name, changed) => {
      expect(() => cipher.decrypt(changed)).toThrow(ChildDataDecryptionError);
    });

    it('what another key wrote', () => {
      expect(() => cipherWith(randomBytes(32)).decrypt(encrypted)).toThrow(
        ChildDataDecryptionError,
      );
    });

    it('without repeating the ciphertext in the error', () => {
      const changed = withPart(encrypted, 2, flipFirst);
      const ciphertext = changed.split('.')[2] ?? '';

      expect(() => cipher.decrypt(changed)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(ciphertext) }),
      );
    });
  });

  describe('lookup', () => {
    it('is the same for the same account in the same family, as 64 hex digits', () => {
      const value = cipher.lookup(familyId, 'xiaomi');

      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(cipher.lookup(familyId, 'xiaomi')).toBe(value);
      expect(cipherWith(Buffer.from(key)).lookup(familyId, 'xiaomi')).toBe(value);
    });

    it('differs for another account, another family or another key', () => {
      const value = cipher.lookup(familyId, 'xiaomi');

      expect(cipher.lookup(familyId, 'xiaomi2')).not.toBe(value);
      expect(cipher.lookup(randomUUID(), 'xiaomi')).not.toBe(value);
      expect(cipherWith(randomBytes(32)).lookup(familyId, 'xiaomi')).not.toBe(value);
    });

    it('does not let the family id and the account run into each other', () => {
      expect(cipher.lookup('family-1', 'abc')).not.toBe(cipher.lookup('family-1a', 'bc'));
      expect(cipher.lookup('a","b', 'c')).not.toBe(cipher.lookup('a', 'b","c'));
    });

    it('finds the account however it was typed', () => {
      expect(cipher.lookup(familyId, ' XiaoMi ')).toBe(cipher.lookup(familyId, 'xiaomi'));
    });

    it('uses a key derived from the master key, not the master key itself', () => {
      const withMasterKey = createHmac('sha256', key)
        .update(JSON.stringify([familyId, 'xiaomi']))
        .digest('hex');

      expect(cipher.lookup(familyId, 'xiaomi')).not.toBe(withMasterKey);
    });
  });

  it('normalises an account by trimming it and writing it in lower case', () => {
    expect(normaliseAccount('  XiaoMi2016\t')).toBe('xiaomi2016');
    expect(normaliseAccount('xiaomi')).toBe('xiaomi');
  });
});
