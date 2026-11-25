import type { ChildDataCipher } from '../infrastructure/child-data/child-data-cipher.js';
import type { Executor } from '../infrastructure/database/database.module.js';

/** The infrastructure a data migration may use besides its transaction. */
export interface DataMigrationContext {
  /** The child data cipher, which writes ciphertexts in the current format. */
  cipher: ChildDataCipher;
  /** CHILD_DATA_KEY itself, for reading ciphertexts written in an earlier format. */
  childDataKey: Buffer;
}

/**
 * A data migration written in code (decision 0018): a change to the data
 * that needs code or keys, which SQL cannot make. It lives in
 * `src/data-migrations/<name>.ts` and runs once, in one transaction, after
 * `drizzle-kit migrate`, so it reads and writes the tables as the schema
 * has them now. Like a migration script, it is never changed once merged.
 */
export interface DataMigration<Context = DataMigrationContext> {
  /** The file name without `.ts`: four digits of version, a hyphen and a name, such as `0001-bind-child-ciphertexts`. */
  name: string;
  run(transaction: Executor, context: Context): Promise<void>;
}
