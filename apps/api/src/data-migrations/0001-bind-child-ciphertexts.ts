import { eq, sql } from 'drizzle-orm';
import { encryptionKeyOf, openCiphertext } from '../infrastructure/child-data/child-data-cipher.js';
import { childDevices, children } from '../infrastructure/database/schema.js';
import type { DataMigration } from './data-migration.js';

/**
 * The additional authenticated data of every ciphertext written before
 * this migration: the key id alone, which bound a ciphertext to no place.
 */
const UNBOUND_DATA = Buffer.from('v1');

/**
 * Binds every existing ciphertext of children's personal data to its place
 * (`.docs/design/data.md`, "孩子个人信息的密文"; decision 0034): the
 * nicknames and accounts of `children` and the names of `child_devices`
 * are read as they were written, with the key id alone as additional data,
 * and written again by the cipher, which binds each to its table, column
 * and row. The layout and the length of a ciphertext stay as they are. A
 * ciphertext that does not decrypt stops the migration, and its
 * transaction leaves every row as it was. A child's `updated_at` is kept:
 * nothing a parent sees has changed.
 */
export const bindChildCiphertexts: DataMigration = {
  name: '0001-bind-child-ciphertexts',

  async run(transaction, { cipher, childDataKey }) {
    const key = encryptionKeyOf(childDataKey);
    const readUnbound = (encrypted: string) => openCiphertext(key, encrypted, UNBOUND_DATA);

    const childRows = await transaction
      .select({ id: children.id, nickname: children.nickname, account: children.account })
      .from(children)
      .for('update');
    for (const child of childRows) {
      await transaction
        .update(children)
        .set({
          nickname: cipher.encrypt(readUnbound(child.nickname), {
            column: children.nickname,
            rowId: child.id,
          }),
          account: cipher.encrypt(readUnbound(child.account), {
            column: children.account,
            rowId: child.id,
          }),
          updatedAt: sql`${children.updatedAt}`,
        })
        .where(eq(children.id, child.id));
    }

    const deviceRows = await transaction
      .select({ id: childDevices.id, name: childDevices.name })
      .from(childDevices)
      .for('update');
    for (const device of deviceRows) {
      await transaction
        .update(childDevices)
        .set({
          name: cipher.encrypt(readUnbound(device.name), {
            column: childDevices.name,
            rowId: device.id,
          }),
        })
        .where(eq(childDevices.id, device.id));
    }
  },
};
