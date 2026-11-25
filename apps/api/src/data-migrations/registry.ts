import { bindChildCiphertexts } from './0001-bind-child-ciphertexts.js';
import type { DataMigration } from './data-migration.js';

/**
 * Every data migration, in the order they run. A new one is added at the
 * end, in a file of its own named after it; the runner refuses a migration
 * file that is missing here.
 */
export const registeredDataMigrations: readonly DataMigration[] = [bindChildCiphertexts];
