/** PostgreSQL's error code for a unique violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * PostgreSQL's error codes for a refused foreign key: a row that names one
 * that is not there (foreign_key_violation), and a referenced row deleted
 * while rows still name it, which an `on delete restrict` key reports as
 * restrict_violation and a `no action` key as foreign_key_violation.
 */
export const FOREIGN_KEY_VIOLATIONS: readonly string[] = ['23503', '23001'];

/**
 * Whether the error, or an error it was caused by, is a violation of the
 * named constraint or unique index with one of the given codes. Drizzle
 * wraps the driver's error in its own, with the driver's as the cause.
 */
export function isConstraintViolation(
  error: unknown,
  codes: readonly string[],
  constraint: string,
): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const { code, constraint: violated } = current as { code?: unknown; constraint?: unknown };
    if (typeof code === 'string' && codes.includes(code) && violated === constraint) {
      return true;
    }
  }
  return false;
}

/** Whether the error, or an error it was caused by, is a unique violation of the named constraint. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return isConstraintViolation(error, [UNIQUE_VIOLATION], constraint);
}

/**
 * Runs a write and turns a violation of the named constraint with one of
 * the given codes into the caller's own error, with the database's error as
 * its cause; any other error is rethrown as it is.
 */
export async function translatingConstraintViolation<T>(
  codes: readonly string[],
  constraint: string,
  toError: (options: ErrorOptions) => Error,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isConstraintViolation(error, codes, constraint)) {
      throw toError({ cause: error });
    }
    throw error;
  }
}

/**
 * Runs a write and turns a unique violation of the named constraint into the
 * caller's own error, with the database's error as its cause.
 */
export function translatingUniqueViolation<T>(
  constraint: string,
  toError: (options: ErrorOptions) => Error,
  write: () => Promise<T>,
): Promise<T> {
  return translatingConstraintViolation([UNIQUE_VIOLATION], constraint, toError, write);
}
