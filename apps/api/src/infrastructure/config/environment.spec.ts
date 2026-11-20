import { environmentSchema } from './environment.js';

const valid = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/app',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
};

function failingVariables(input: Record<string, unknown>): string[] {
  const result = environmentSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
}

describe('environmentSchema', () => {
  it('accepts a complete environment and applies defaults', () => {
    expect(environmentSchema.parse(valid)).toEqual({
      ...valid,
      PORT: 3000,
      S3_FORCE_PATH_STYLE: false,
    });
  });

  it('converts PORT and S3_FORCE_PATH_STYLE from strings', () => {
    const environment = environmentSchema.parse({
      ...valid,
      PORT: '8080',
      S3_FORCE_PATH_STYLE: 'true',
    });

    expect(environment.PORT).toBe(8080);
    expect(environment.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('ignores variables it does not declare', () => {
    expect(environmentSchema.parse({ ...valid, HOME: '/home/user' })).not.toHaveProperty('HOME');
  });

  it.each(Object.keys(valid))('names %s when it is missing', (name) => {
    const input: Record<string, unknown> = { ...valid };
    delete input[name];

    expect(failingVariables(input)).toEqual([name]);
  });

  it.each(['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])(
    'names %s when it is empty',
    (name) => {
      expect(failingVariables({ ...valid, [name]: '' })).toEqual([name]);
    },
  );

  it('names DATABASE_URL when it is not a PostgreSQL URL', () => {
    expect(failingVariables({ ...valid, DATABASE_URL: 'mysql://localhost/app' })).toEqual([
      'DATABASE_URL',
    ]);
    expect(failingVariables({ ...valid, DATABASE_URL: 'not a url' })).toEqual(['DATABASE_URL']);
  });

  it('names S3_ENDPOINT when it is not an HTTP URL', () => {
    expect(failingVariables({ ...valid, S3_ENDPOINT: 'ftp://localhost' })).toEqual(['S3_ENDPOINT']);
  });

  it.each(['0', '65536', 'abc', '80.5'])('names PORT when it is %s', (port) => {
    expect(failingVariables({ ...valid, PORT: port })).toEqual(['PORT']);
  });

  it('names S3_FORCE_PATH_STYLE when it is not true or false', () => {
    expect(failingVariables({ ...valid, S3_FORCE_PATH_STYLE: 'yes' })).toEqual([
      'S3_FORCE_PATH_STYLE',
    ]);
  });

  it('names every bad variable at once', () => {
    expect(failingVariables({ ...valid, DATABASE_URL: undefined, S3_BUCKET: '' })).toEqual([
      'DATABASE_URL',
      'S3_BUCKET',
    ]);
  });

  it('does not repeat the rejected value in its messages', () => {
    const result = environmentSchema.safeParse({ ...valid, DATABASE_URL: 'secret-value' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('secret-value');
  });
});
