import {
  FOREIGN_KEY_VIOLATIONS,
  isConstraintViolation,
  isUniqueViolation,
  translatingConstraintViolation,
  translatingUniqueViolation,
} from './unique-violation.js';

/** A driver error of the code and constraint, wrapped the way Drizzle wraps it. */
function wrapped(code: string, constraint: string): Error {
  const driverError = Object.assign(new Error('violation'), { code, constraint });
  return new Error('Failed query', { cause: driverError });
}

class Translated extends Error {}

describe('constraint violations', () => {
  it('finds a violation of the constraint with one of the codes in the cause', () => {
    expect(isConstraintViolation(wrapped('23001', 'key'), FOREIGN_KEY_VIOLATIONS, 'key')).toBe(
      true,
    );
    expect(isConstraintViolation(wrapped('23503', 'key'), FOREIGN_KEY_VIOLATIONS, 'key')).toBe(
      true,
    );
    expect(isUniqueViolation(wrapped('23505', 'unique'), 'unique')).toBe(true);
  });

  it.each([
    ['another constraint', wrapped('23505', 'other')],
    ['another code', wrapped('23503', 'unique')],
    ['an error without a code', new Error('connection lost')],
    ['something that is not an error', 'failed'],
  ])('finds none in %s', (_case, error) => {
    expect(isUniqueViolation(error, 'unique')).toBe(false);
  });

  it("turns the violation into the caller's error with the database's as its cause", async () => {
    const violation = wrapped('23001', 'key');

    const failure = translatingConstraintViolation(
      FOREIGN_KEY_VIOLATIONS,
      'key',
      (options) => new Translated('translated', options),
      () => Promise.reject(violation),
    );

    await expect(failure).rejects.toBeInstanceOf(Translated);
    await expect(failure).rejects.toMatchObject({ cause: violation });
  });

  it('passes on any other error and the result of a write that succeeds', async () => {
    const other = new Error('connection lost');
    const toError = (options: ErrorOptions) => new Translated('translated', options);

    await expect(
      translatingUniqueViolation('unique', toError, () => Promise.reject(other)),
    ).rejects.toBe(other);
    await expect(
      translatingUniqueViolation('unique', toError, () => Promise.resolve(7)),
    ).resolves.toBe(7);
  });
});
