import { z } from 'zod';
import { environmentSchema } from './environment.js';

/**
 * A variable that may be unset. One set to an empty string, as a CI
 * variable with no value reaches the process, counts as unset.
 */
export function unsetWhenEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

/**
 * The database variables of a command that runs after the migrations, such
 * as the cover import and the data migrations: MIGRATION_DATABASE_URL, the
 * direct connection CD migrates through, else DATABASE_URL.
 */
export const commandDatabaseShape = {
  MIGRATION_DATABASE_URL: unsetWhenEmpty(environmentSchema.shape.DATABASE_URL),
  DATABASE_URL: unsetWhenEmpty(environmentSchema.shape.DATABASE_URL),
};

/** The database variables as a command's environment has them before its URL is settled. */
export interface CommandDatabaseVariables {
  MIGRATION_DATABASE_URL?: string | undefined;
  DATABASE_URL?: string | undefined;
}

/**
 * The transform of a command's environment that settles its database URL:
 * MIGRATION_DATABASE_URL when it is set, else DATABASE_URL, handed on as
 * DATABASE_URL, the one the database module reads. With neither set, the
 * environment is refused.
 */
export function withCommandDatabaseUrl<T extends CommandDatabaseVariables>(
  { MIGRATION_DATABASE_URL, DATABASE_URL, ...rest }: T,
  context: z.RefinementCtx,
): Omit<T, keyof CommandDatabaseVariables> & { DATABASE_URL: string } {
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
}
