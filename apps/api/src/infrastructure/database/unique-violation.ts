/** PostgreSQL's error code for a unique violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether the error, or an error it was caused by, is a unique violation of
 * the named constraint or unique index. Drizzle wraps the driver's error in
 * its own, with the driver's as the cause.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const { code, constraint: violated } = current as { code?: unknown; constraint?: unknown };
    if (code === UNIQUE_VIOLATION && violated === constraint) {
      return true;
    }
  }
  return false;
}

/**
 * Runs a write and turns a unique violation of the named constraint into the
 * caller's own error, with the database's error as its cause; any other
 * error is rethrown as it is.
 */
export async function translatingUniqueViolation<T>(
  constraint: string,
  toError: (options: ErrorOptions) => Error,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, constraint)) {
      throw toError({ cause: error });
    }
    throw error;
  }
}
