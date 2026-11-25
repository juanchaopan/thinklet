import type { z } from 'zod';
import { commandDatabaseShape, withCommandDatabaseUrl } from './command-environment.js';
import { environmentSchema } from './environment.js';

/**
 * The environment variables the data migrations (migrate-data.ts) read, and
 * only those: the database, as MIGRATION_DATABASE_URL else DATABASE_URL,
 * and CHILD_DATA_KEY, which a migration of children's ciphertexts needs.
 */
export const dataMigrationEnvironmentSchema = environmentSchema
  .pick({ CHILD_DATA_KEY: true })
  .extend(commandDatabaseShape)
  .transform(withCommandDatabaseUrl);

export type DataMigrationEnvironment = z.output<typeof dataMigrationEnvironmentSchema>;
