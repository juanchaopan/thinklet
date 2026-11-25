import { z } from 'zod';
import {
  commandDatabaseShape,
  unsetWhenEmpty,
  withCommandDatabaseUrl,
} from './command-environment.js';
import { environmentSchema } from './environment.js';

/**
 * The environment variables the cover import (rebuild.ts) reads, and only
 * those, so it runs where just the database and storage are configured.
 * The database URL is MIGRATION_DATABASE_URL, the direct connection CD
 * migrates through, else DATABASE_URL; either way it reaches the database
 * module as DATABASE_URL. BOOK_CONTENT_DIRECTORY replaces the repository's
 * content/books/ folder, as an absolute path or one relative to the working
 * directory.
 */
export const rebuildEnvironmentSchema = environmentSchema
  .pick({
    S3_ENDPOINT: true,
    S3_REGION: true,
    S3_BUCKET: true,
    S3_ACCESS_KEY_ID: true,
    S3_SECRET_ACCESS_KEY: true,
    S3_FORCE_PATH_STYLE: true,
  })
  .extend({
    ...commandDatabaseShape,
    BOOK_CONTENT_DIRECTORY: unsetWhenEmpty(z.string()),
  })
  .transform(withCommandDatabaseUrl);

export type RebuildEnvironment = z.output<typeof rebuildEnvironmentSchema>;
