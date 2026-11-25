import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getTableName } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Environment } from '../config/environment.js';
import { decodeCanonicalBase64 } from '../encoding/canonical-base64.js';

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

/** Ciphertext that is malformed, names a key this api does not have, or was changed or moved. */
export class ChildDataDecryptionError extends Error {
  override readonly name = 'ChildDataDecryptionError';

  constructor(reason: string) {
    super(`Child data cannot be decrypted: ${reason}`);
  }
}

/**
 * Where a ciphertext is stored: its column, which belongs to its table, and
 * the primary key of its row. A ciphertext is bound to its place, so it
 * decrypts only where it was written.
 */
export interface CiphertextPlace {
  column: AnyPgColumn;
  rowId: string;
}

/**
 * The 32-byte subkey of one use of CHILD_DATA_KEY, derived with
 * HKDF-SHA256 under the use's own label, so no two uses share a key.
 */
export function subkey(masterKey: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, '', info, KEY_BYTES));
}

/** The AES-256-GCM key derived from CHILD_DATA_KEY. */
export function encryptionKeyOf(masterKey: Buffer): Buffer {
  return subkey(masterKey, ENCRYPTION_INFO);
}

/**
 * The additional authenticated data of a ciphertext at its place: the key
 * id, the table name, the column name and the row's primary key, encoded as
 * a JSON array so that no set of values can run into another.
 */
function placeData(place: CiphertextPlace): Buffer {
  return Buffer.from(
    JSON.stringify([KEY_ID, getTableName(place.column.table), place.column.name, place.rowId]),
  );
}

/** A part of a ciphertext decoded into bytes, only when it is their canonical base64url. */
function decodePart(text: string, part: string): Buffer {
  const bytes = decodeCanonicalBase64(text, 'base64url');
  if (bytes === undefined) {
    throw new ChildDataDecryptionError(`the ${part} is not base64url`);
  }
  return bytes;
}

/**
 * The ciphertext of the text under the key, with the additional
 * authenticated data: `<key id>.<iv>.<ciphertext>.<tag>`, each part after
 * the key id in unpadded base64url, with a new random 12-byte IV. With
 * `openCiphertext`, it is the layout every format of child data shares;
 * ChildDataCipher gives the additional data of the current format, and a
 * data migration names that of an earlier one.
 */
export function sealCiphertext(key: Buffer, plaintext: string, additionalData: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const parts = [iv, ciphertext, cipher.getAuthTag()].map((part) => part.toString('base64url'));
  return [KEY_ID, ...parts].join('.');
}

/**
 * The text of a ciphertext written under the key with the same additional
 * authenticated data. Throws ChildDataDecryptionError when it is
 * malformed, names another key or fails authentication; the error never
 * carries the ciphertext or any part of the text.
 */
export function openCiphertext(key: Buffer, encrypted: string, additionalData: Buffer): string {
  const parts = encrypted.split('.');
  if (parts.length !== 4) {
    throw new ChildDataDecryptionError('it does not have four parts');
  }
  const [keyId = '', ivText = '', ciphertextText = '', tagText = ''] = parts;
  if (keyId !== KEY_ID) {
    throw new ChildDataDecryptionError('it names an unknown key');
  }
  const iv = decodePart(ivText, 'IV');
  const ciphertext = decodePart(ciphertextText, 'ciphertext');
  const tag = decodePart(tagText, 'tag');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new ChildDataDecryptionError('the IV or the tag has the wrong length');
  }
  const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(additionalData);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new ChildDataDecryptionError('it fails authentication or was moved from its place');
  }
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
 * key id in base64url. Every value gets its own random 12-byte IV. The key
 * id, the table, the column and the row's primary key are authenticated
 * with the data, so neither the data, the IV, the tag nor the key id can be
 * changed unnoticed, and a ciphertext moved to another row or column does
 * not decrypt there.
 */
@Injectable()
export class ChildDataCipher {
  private readonly encryptionKey: Buffer;
  private readonly lookupKey: Buffer;

  constructor(config: ConfigService<Environment, true>) {
    const masterKey = config.get('CHILD_DATA_KEY', { infer: true });
    this.encryptionKey = encryptionKeyOf(masterKey);
    this.lookupKey = subkey(masterKey, LOOKUP_INFO);
  }

  /** The ciphertext of the text at its place, different on every call. */
  encrypt(plaintext: string, place: CiphertextPlace): string {
    return sealCiphertext(this.encryptionKey, plaintext, placeData(place));
  }

  /**
   * The text of a ciphertext at its place. Throws ChildDataDecryptionError
   * when it is malformed, names another key, fails authentication or was
   * written for another place; the error never carries the ciphertext or
   * any part of the text.
   */
  decrypt(encrypted: string, place: CiphertextPlace): string {
    return openCiphertext(this.encryptionKey, encrypted, placeData(place));
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
