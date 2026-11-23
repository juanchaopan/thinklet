import { z } from 'zod';
import { environmentSchema } from './environment.js';

/**
 * A variable that may be unset. One set to an empty string, as a CI
 * variable with no value reaches the process, counts as unset.
 */
function unsetWhenEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

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
    MIGRATION_DATABASE_URL: unsetWhenEmpty(environmentSchema.shape.DATABASE_URL),
    DATABASE_URL: unsetWhenEmpty(environmentSchema.shape.DATABASE_URL),
    BOOK_CONTENT_DIRECTORY: unsetWhenEmpty(z.string()),
  })
  .transform(({ MIGRATION_DATABASE_URL, DATABASE_URL, ...rest }, context) => {
    const url = MIGRATION_DATABASE_URL ?? DATABASE_URL;
    if (url === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['MIGRATION_DATABASE_URL'],
        message: 'Set MIGRATION_DATABASE_URL or DATABASE_URL',
      });
      return z.NEVER;
    }
    return { ...rest, DATABASE_URL: url };
  });

export type RebuildEnvironment = z.output<typeof rebuildEnvironmentSchema>;
