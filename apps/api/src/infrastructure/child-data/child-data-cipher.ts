import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

const CIPHER = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The id of the key every ciphertext is written with. It names the master
 * key and the derivation together, so a rotated key gets the next id and
 * old and new ciphertexts can be told apart while both exist.
 */
const KEY_ID = 'v1';

/** HKDF labels: one subkey per use, so the encryption key never doubles as the lookup key. */
const ENCRYPTION_INFO = 'thinklet child data encryption v1';
const LOOKUP_INFO = 'thinklet child data lookup v1';

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Ciphertext that is malformed, names a key this api does not have, or was changed. */
export class ChildDataDecryptionError extends Error {
  override readonly name = 'ChildDataDecryptionError';

  constructor(reason: string) {
    super(`Child data cannot be decrypted: ${reason}`);
  }
}

/**
 * Base64url text decoded into bytes, only when it is the canonical encoding
 * of those bytes: Node's decoder skips characters it does not know, so text
 * with stray characters would otherwise decode into other bytes.
 */
function decodeBase64url(text: string, part: string): Buffer {
  const bytes = Buffer.from(text, 'base64url');
  if (!BASE64URL.test(text) || bytes.toString('base64url') !== text) {
    throw new ChildDataDecryptionError(`the ${part} is not base64url`);
  }
  return bytes;
}

/**
 * The account as its lookup value is computed from: without surrounding
 * spaces and in lower case, as the account is entered (`.docs/design/rules.md`,
 * "孩子"), so the same account always finds the same child.
 */
export function normaliseAccount(account: string): string {
  return account.trim().toLowerCase();
}

/**
 * Field encryption of children's personal data (decision 0034): the
 * nickname, the account and the names of remembered devices. Two subkeys
 * are derived from CHILD_DATA_KEY with HKDF-SHA256, one for AES-256-GCM and
 * one for the account's HMAC-SHA256 lookup value. Repositories call it when
 * they write and read; services and controllers see plain text only.
 *
 * A ciphertext is `<key id>.<iv>.<ciphertext>.<tag>`, each part after the
 * key id in base64url. Every value gets its own random 12-byte IV, and the
 * key id is authenticated with the data, so neither the data, the IV, the
 * tag nor the key id can be changed unnoticed.
 */
@Injectable()
export class ChildDataCipher {
  private readonly encryptionKey: Buffer;
  private readonly lookupKey: Buffer;

  constructor(config: ConfigService<Environment, true>) {
    const masterKey = config.get('CHILD_DATA_KEY', { infer: true });
    this.encryptionKey = Buffer.from(hkdfSync('sha256', masterKey, '', ENCRYPTION_INFO, KEY_BYTES));
    this.lookupKey = Buffer.from(hkdfSync('sha256', masterKey, '', LOOKUP_INFO, KEY_BYTES));
  }

  /** The ciphertext of the text, different on every call. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER, this.encryptionKey, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(KEY_ID));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const parts = [iv, ciphertext, cipher.getAuthTag()].map((part) => part.toString('base64url'));
    return [KEY_ID, ...parts].join('.');
  }

  /**
   * The text of a ciphertext. Throws ChildDataDecryptionError when it is
   * malformed, names another key or fails authentication; the error never
   * carries the ciphertext or any part of the text.
   */
  decrypt(encrypted: string): string {
    const parts = encrypted.split('.');
    if (parts.length !== 4) {
      throw new ChildDataDecryptionError('it does not have four parts');
    }
    const [keyId = '', ivText = '', ciphertextText = '', tagText = ''] = parts;
    if (keyId !== KEY_ID) {
      throw new ChildDataDecryptionError('it names an unknown key');
    }
    const iv = decodeBase64url(ivText, 'IV');
    const ciphertext = decodeBase64url(ciphertextText, 'ciphertext');
    const tag = decodeBase64url(tagText, 'tag');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new ChildDataDecryptionError('the IV or the tag has the wrong length');
    }
    const decipher = createDecipheriv(CIPHER, this.encryptionKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(keyId));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new ChildDataDecryptionError('it fails authentication');
    }
  }

  /**
   * The lookup value of an account in a family: HMAC-SHA256 in hex over the
   * family id and the normalised account. The two are encoded as a JSON
   * array, so no pair of values can run into another pair. The same account
   * in the same family always gives the same value, and in another family a
   * different one, so the database can keep accounts unique per family and
   * find a child at login without the account in clear.
   */
  lookup(familyId: string, account: string): string {
    return createHmac('sha256', this.lookupKey)
      .update(JSON.stringify([familyId, normaliseAccount(account)]))
      .digest('hex');
  }
}
