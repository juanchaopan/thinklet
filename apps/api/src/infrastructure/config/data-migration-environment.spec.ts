import { randomBytes } from 'node:crypto';
import { dataMigrationEnvironmentSchema } from './data-migration-environment.js';

const migrationUrl = 'postgresql://owner:secret@direct.example:5432/app';
const pooledUrl = 'postgresql://user:secret@pooled.example:5432/app';
const key = randomBytes(32);
const CHILD_DATA_KEY = key.toString('base64');

function failingVariables(input: Record<string, unknown>): string[] {
  const result = dataMigrationEnvironmentSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
}

describe('dataMigrationEnvironmentSchema', () => {
  it('needs only the database and the child data key, read as its bytes', () => {
    expect(
      dataMigrationEnvironmentSchema.parse({ DATABASE_URL: pooledUrl, CHILD_DATA_KEY }),
    ).toEqual({ DATABASE_URL: pooledUrl, CHILD_DATA_KEY: key });
  });

  it('connects through MIGRATION_DATABASE_URL when it is set, as CD sets it', () => {
    expect(
      dataMigrationEnvironmentSchema.parse({
        MIGRATION_DATABASE_URL: migrationUrl,
        DATABASE_URL: pooledUrl,
        CHILD_DATA_KEY,
      }),
    ).toMatchObject({ DATABASE_URL: migrationUrl });
    expect(
      dataMigrationEnvironmentSchema.parse({
        MIGRATION_DATABASE_URL: migrationUrl,
        CHILD_DATA_KEY,
      }),
    ).toMatchObject({ DATABASE_URL: migrationUrl });
  });

  it('refuses an environment without the child data key or with a short one', () => {
    expect(failingVariables({ DATABASE_URL: pooledUrl })).toEqual(['CHILD_DATA_KEY']);
    expect(
      failingVariables({
        DATABASE_URL: pooledUrl,
        CHILD_DATA_KEY: randomBytes(16).toString('base64'),
      }),
    ).toEqual(['CHILD_DATA_KEY']);
  });

  it('refuses an environment with neither database URL', () => {
    expect(failingVariables({ CHILD_DATA_KEY })).toEqual(['MIGRATION_DATABASE_URL']);
  });
});
