import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { DATABASE_ERROR_MESSAGE, describeError } from './describe-error.js';

/** Personal data and a family code, as the parameters of a failed query carry them. */
const VALUES = { name: '林悦', email: 'linyue@example.com', code: '7KQ4MZ' };

const FAILED_SQL =
  'insert into "families" ("name", "timezone", "code") values ($1, $2, $3) returning "id"';

/** An error the database reported, as pg builds it, quoting a value in its message and detail. */
function databaseError(code: string): DatabaseError {
  return Object.assign(
    new DatabaseError(
      `duplicate key value violates unique constraint, code ${VALUES.code}`,
      0,
      'error',
    ),
    {
      severity: 'ERROR',
      code,
      detail: `Key (code)=(${VALUES.code}) already exists.`,
      constraint: 'families_code_unique',
    },
  );
}

/** Drizzle's error for a query that failed with the cause. */
function failedQuery(cause?: unknown): DrizzleQueryError {
  return new DrizzleQueryError(
    FAILED_SQL,
    [VALUES.name, VALUES.email, VALUES.code],
    cause as Error | undefined,
  );
}

/** Asserts that the description holds none of the query's values or its SQL. */
function expectNoValues(description: unknown): void {
  const logged = JSON.stringify(description);
  for (const value of Object.values(VALUES)) {
    expect(logged).not.toContain(value);
  }
  expect(logged).not.toContain('insert into');
  expect(logged).not.toContain('Failed query');
}

describe('describeError', () => {
  it('keeps the name and message of an error', () => {
    expect(describeError(new TypeError('bad input'))).toEqual({
      name: 'TypeError',
      message: 'bad input',
    });
  });

  it('replaces URLs in the message', () => {
    const error = new Error(
      'cannot reach postgresql://user:secret@db.example.com:5432/app or https://s3.example.com/bucket',
    );

    const { message } = describeError(error);

    expect(message).toBe('cannot reach [url] or [url]');
    expect(message).not.toContain('secret');
  });

  it('keeps a string error code', () => {
    const error = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });

    expect(describeError(error)).toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('ignores a code that is not a string', () => {
    const error = Object.assign(new Error('failed'), { code: 42 });

    expect(describeError(error)).not.toHaveProperty('code');
  });

  it('keeps the HTTP status of an AWS SDK error', () => {
    const error = Object.assign(new Error('UnknownError'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });

    expect(describeError(error)).toEqual({
      name: 'NotFound',
      message: 'UnknownError',
      status: 404,
    });
  });

  it('leaves out the stack and the cause', () => {
    const error = new Error('outer', { cause: new Error('postgresql://user:secret@host/db') });

    expect(Object.keys(describeError(error)).sort()).toEqual(['message', 'name']);
  });

  it('describes a thrown value that is not an error without repeating it', () => {
    const description = describeError('postgresql://user:secret@host/db');

    expect(description.name).toBe('UnknownError');
    expect(JSON.stringify(description)).not.toContain('secret');
  });

  describe('of a database error', () => {
    it('logs a failed query without its SQL or parameter values', () => {
      const description = describeError(failedQuery());

      expect(description).toEqual({ name: 'DrizzleQueryError', message: DATABASE_ERROR_MESSAGE });
      expectNoValues(description);
    });

    it("logs a failed query's database error by its class and SQLSTATE, without its message or detail", () => {
      const description = describeError(failedQuery(databaseError('23505')));

      expect(description).toEqual({
        name: 'DrizzleQueryError',
        message: DATABASE_ERROR_MESSAGE,
        causes: [{ name: 'DatabaseError', code: '23505' }],
      });
      expectNoValues(description);
    });

    it('logs a statement timeout by its SQLSTATE', () => {
      const description = describeError(failedQuery(databaseError('57014')));

      expect(JSON.stringify(description)).toContain('57014');
      expectNoValues(description);
    });

    it('logs an error the database reported by its class and SQLSTATE only', () => {
      const description = describeError(databaseError('08006'));

      expect(description).toEqual({
        name: 'DatabaseError',
        message: DATABASE_ERROR_MESSAGE,
        code: '08006',
      });
      expectNoValues(description);
    });

    it('follows the cause chain by class and code, leaving out every message', () => {
      const refused = Object.assign(new Error(`connect refused for ${VALUES.email}`), {
        code: 'ECONNREFUSED',
      });
      const terminated = new Error(`Connection terminated for ${VALUES.name}`, { cause: refused });

      const description = describeError(failedQuery(terminated));

      expect(description.causes).toEqual([
        { name: 'Error' },
        { name: 'Error', code: 'ECONNREFUSED' },
      ]);
      expectNoValues(description);
    });

    it('ends a cause chain that loops back', () => {
      const first = new Error(VALUES.code);
      const second = new Error(VALUES.code, { cause: first });
      first.cause = second;

      const description = describeError(failedQuery(first));

      expect(description.causes).toEqual([{ name: 'Error' }, { name: 'Error' }]);
      expectNoValues(description);
    });

    it('logs any error that carries a query and its parameters with the fixed message', () => {
      const error = Object.assign(
        new Error(`Failed query: ${FAILED_SQL}\nparams: ${Object.values(VALUES).join(',')}`),
        { query: FAILED_SQL, params: Object.values(VALUES) },
      );

      const description = describeError(error);

      expect(description).toEqual({ name: 'Error', message: DATABASE_ERROR_MESSAGE });
      expectNoValues(description);
    });
  });
});
