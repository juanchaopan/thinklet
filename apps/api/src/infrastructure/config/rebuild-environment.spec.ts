import { rebuildEnvironmentSchema } from './rebuild-environment.js';

const migrationUrl = 'postgresql://owner:secret@direct.example:5432/app';
const pooledUrl = 'postgresql://user:secret@pooled.example:5432/app';

const storage = {
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
};

function failingVariables(input: Record<string, unknown>): string[] {
  const result = rebuildEnvironmentSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
}

describe('rebuildEnvironmentSchema', () => {
  it('needs only the database and storage', () => {
    expect(rebuildEnvironmentSchema.parse({ ...storage, DATABASE_URL: pooledUrl })).toEqual({
      ...storage,
      S3_FORCE_PATH_STYLE: false,
      DATABASE_URL: pooledUrl,
    });
  });

  it('connects through MIGRATION_DATABASE_URL when it is set', () => {
    expect(
      rebuildEnvironmentSchema.parse({
        ...storage,
        MIGRATION_DATABASE_URL: migrationUrl,
        DATABASE_URL: pooledUrl,
      }),
    ).toMatchObject({ DATABASE_URL: migrationUrl });
  });

  it('takes MIGRATION_DATABASE_URL alone, as CD sets it', () => {
    expect(
      rebuildEnvironmentSchema.parse({ ...storage, MIGRATION_DATABASE_URL: migrationUrl }),
    ).toMatchObject({ DATABASE_URL: migrationUrl });
  });

  it('counts an empty MIGRATION_DATABASE_URL as unset', () => {
    expect(
      rebuildEnvironmentSchema.parse({
        ...storage,
        MIGRATION_DATABASE_URL: '',
        DATABASE_URL: pooledUrl,
      }),
    ).toMatchObject({ DATABASE_URL: pooledUrl });
  });

  it('refuses an environment with neither database URL', () => {
    expect(failingVariables(storage)).toEqual(['MIGRATION_DATABASE_URL']);
  });

  it('refuses a database URL that is not PostgreSQL', () => {
    expect(failingVariables({ ...storage, MIGRATION_DATABASE_URL: 'mysql://host/app' })).toEqual([
      'MIGRATION_DATABASE_URL',
    ]);
  });

  it('refuses missing storage variables', () => {
    expect(failingVariables({ DATABASE_URL: pooledUrl, S3_ENDPOINT: storage.S3_ENDPOINT })).toEqual(
      ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    );
  });

  it('passes the content directory on, and counts an empty one as unset', () => {
    const base = { ...storage, DATABASE_URL: pooledUrl };

    expect(
      rebuildEnvironmentSchema.parse({ ...base, BOOK_CONTENT_DIRECTORY: '/fixtures/books' }),
    ).toMatchObject({ BOOK_CONTENT_DIRECTORY: '/fixtures/books' });
    expect(
      rebuildEnvironmentSchema.parse({ ...base, BOOK_CONTENT_DIRECTORY: '' })
        .BOOK_CONTENT_DIRECTORY,
    ).toBeUndefined();
  });

  it('reads none of the api variables it does not need', () => {
    const parsed = rebuildEnvironmentSchema.parse({
      ...storage,
      DATABASE_URL: pooledUrl,
      OIDC_CLIENT_SECRET: 'not-needed',
    });

    expect(parsed).not.toHaveProperty('OIDC_CLIENT_SECRET');
  });
});
