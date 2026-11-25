import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { childDevices, children } from '../database/schema.js';
import {
  ChildDataCipher,
  ChildDataDecryptionError,
  encryptionKeyOf,
  normaliseAccount,
  openCiphertext,
  sealCiphertext,
  type CiphertextPlace,
} from './child-data-cipher.js';

function cipherWith(key: Buffer): ChildDataCipher {
  return new ChildDataCipher({ get: () => key } as unknown as ConfigService<Environment, true>);
}

const key = randomBytes(32);
const cipher = cipherWith(key);
const familyId = randomUUID();
const childId = randomUUID();
const nicknameOfChild: CiphertextPlace = { column: children.nickname, rowId: childId };

/**
 * The format written before ciphertexts were bound to their place: the
 * same layout and key, with the key id alone as the additional data.
 */
const UNBOUND = Buffer.from('v1');

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
      'give back the text %j at its place',
      (text) => {
        expect(cipher.decrypt(cipher.encrypt(text, nicknameOfChild), nicknameOfChild)).toBe(text);
      },
    );

    it('write the key id, a 12-byte IV, the ciphertext and a 16-byte tag', () => {
      const [keyId, iv, ciphertext, tag, ...rest] = cipher
        .encrypt('小米', nicknameOfChild)
        .split('.');

      expect(keyId).toBe('v1');
      expect(Buffer.from(iv ?? '', 'base64url')).toHaveLength(12);
      expect(Buffer.from(ciphertext ?? '', 'base64url')).toHaveLength(Buffer.byteLength('小米'));
      expect(Buffer.from(tag ?? '', 'base64url')).toHaveLength(16);
      expect(rest).toEqual([]);
    });

    it('never show the text and use a new IV every time', () => {
      const first = cipher.encrypt('xiaomi', nicknameOfChild);
      const second = cipher.encrypt('xiaomi', nicknameOfChild);

      expect(first).not.toContain('xiaomi');
      expect(first).not.toBe(second);
      expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
    });

    it('read what another instance with the same key wrote', () => {
      const encrypted = cipher.encrypt('小米', nicknameOfChild);

      expect(cipherWith(Buffer.from(key)).decrypt(encrypted, nicknameOfChild)).toBe('小米');
    });
  });

  describe('decrypt refuses', () => {
    const encrypted = cipher.encrypt('小米', nicknameOfChild);

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
      expect(() => cipher.decrypt(changed, nicknameOfChild)).toThrow(ChildDataDecryptionError);
    });

    it('what another key wrote', () => {
      expect(() => cipherWith(randomBytes(32)).decrypt(encrypted, nicknameOfChild)).toThrow(
        ChildDataDecryptionError,
      );
    });

    it.each<[string, CiphertextPlace]>([
      ["another child's row", { column: children.nickname, rowId: randomUUID() }],
      ['another column of the same row', { column: children.account, rowId: childId }],
      ['another table with the same row id', { column: childDevices.name, rowId: childId }],
    ])('a ciphertext moved to %s', (_name, place) => {
      expect(() => cipher.decrypt(encrypted, place)).toThrow(ChildDataDecryptionError);
    });

    it('a ciphertext written without its place', () => {
      const unbound = sealCiphertext(encryptionKeyOf(key), '小米', UNBOUND);

      expect(() => cipher.decrypt(unbound, nicknameOfChild)).toThrow(ChildDataDecryptionError);
    });

    it('without repeating the ciphertext in the error', () => {
      const changed = withPart(encrypted, 2, flipFirst);
      const ciphertext = changed.split('.')[2] ?? '';

      expect(() => cipher.decrypt(changed, nicknameOfChild)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(ciphertext) }),
      );
    });
  });

  describe('sealCiphertext and openCiphertext', () => {
    it('read a ciphertext with the additional data it was written with, in the same layout', () => {
      const unbound = sealCiphertext(encryptionKeyOf(key), '小米', UNBOUND);

      expect(openCiphertext(encryptionKeyOf(key), unbound, UNBOUND)).toBe('小米');
      expect(unbound.split('.').map((part) => part.length)).toEqual(
        cipher
          .encrypt('小米', nicknameOfChild)
          .split('.')
          .map((part) => part.length),
      );
    });

    it('refuse it with other additional data', () => {
      const unbound = sealCiphertext(encryptionKeyOf(key), '小米', UNBOUND);

      expect(() => openCiphertext(encryptionKeyOf(key), unbound, Buffer.from('v2'))).toThrow(
        ChildDataDecryptionError,
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
