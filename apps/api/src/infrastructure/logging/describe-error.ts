const URL_PATTERN = /[a-z][a-z\d+.-]*:\/\/\S+/gi;

/**
 * The message logged for a database error in place of its own. A failed
 * query's message repeats its SQL and every parameter value, and the
 * database's own messages and details quote the values they reject (`Key
 * (code)=(…) already exists`), so none of them is ever logged.
 */
export const DATABASE_ERROR_MESSAGE =
  'Database error; its message is left out because it can hold query values';

/** How many causes of a database error are described at most, so a cycle or a long chain ends. */
const MAX_CAUSES = 5;

/** What is logged of an error that caused a database error: its class and its code. */
export interface CauseDescription {
  name: string;
  code?: string;
}

export interface ErrorDescription {
  name: string;
  message: string;
  code?: string;
  status?: number;
  /** For a database error, the errors it was caused by, the nearest first. */
  causes?: CauseDescription[];
}

/**
 * Whether the error comes from the database or its driver and may quote the
 * values of a query: a failed query that carries its SQL and parameters
 * (Drizzle's DrizzleQueryError), or an error the database reported, which
 * the driver marks with its severity and may give a detail.
 */
function isDatabaseError(error: Error): boolean {
  const { query, params, severity, detail } = error as {
    query?: unknown;
    params?: unknown;
    severity?: unknown;
    detail?: unknown;
  };
  return (
    query !== undefined ||
    params !== undefined ||
    typeof severity === 'string' ||
    detail !== undefined
  );
}

/** The error's string code: a PostgreSQL SQLSTATE such as `57014`, or a system code such as `ECONNREFUSED`. */
function codeOf(error: Error): string | undefined {
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * The error's class: the constructor's name when it says more than `Error`,
 * else the error's name. Drizzle's query error keeps the name `Error`, and
 * pg names its database errors `error`, so their classes tell them apart.
 */
function classOf(error: Error): string {
  const constructorName = (error.constructor as { name?: unknown } | undefined)?.name;
  const specific =
    typeof constructorName === 'string' && constructorName !== '' && constructorName !== 'Error';
  return specific ? constructorName : error.name;
}

/** The class and code of each error in the cause chain, never their messages. */
function causesOf(error: Error): CauseDescription[] {
  const causes: CauseDescription[] = [];
  const seen = new Set<unknown>([error]);
  for (
    let cause: unknown = error.cause;
    cause instanceof Error && !seen.has(cause) && causes.length < MAX_CAUSES;
    cause = cause.cause
  ) {
    seen.add(cause);
    const code = codeOf(cause);
    causes.push(code === undefined ? { name: classOf(cause) } : { name: classOf(cause), code });
  }
  return causes;
}

/** A database error by its class, its code and its causes' classes and codes, with a fixed message. */
function describeDatabaseError(error: Error): ErrorDescription {
  const description: ErrorDescription = { name: classOf(error), message: DATABASE_ERROR_MESSAGE };
  const code = codeOf(error);
  if (code !== undefined) {
    description.code = code;
  }
  const causes = causesOf(error);
  if (causes.length > 0) {
    description.causes = causes;
  }
  return description;
}

/**
 * Turns a thrown value into fields that are safe to log.
 *
 * A database error is logged by its class and code (the SQLSTATE) and the
 * classes and codes of the errors that caused it, with a fixed message,
 * because its own message and details can hold the values of the query: a
 * parent's name and email, a family's name and code.
 *
 * Any other error is logged by its name, code, HTTP status and message, with
 * any URL in the message replaced, so connection strings and endpoints never
 * reach the logs. Its stack and causes are left out because they can carry
 * the same details.
 */
export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: 'A non-error value was thrown' };
  }
  if (isDatabaseError(error)) {
    return describeDatabaseError(error);
  }

  const description: ErrorDescription = {
    name: error.name,
    message: error.message.replace(URL_PATTERN, '[url]'),
  };
  const code = codeOf(error);
  if (code !== undefined) {
    description.code = code;
  }
  const { $metadata } = error as { $metadata?: { httpStatusCode?: unknown } };
  if (typeof $metadata?.httpStatusCode === 'number') {
    description.status = $metadata.httpStatusCode;
  }
  return description;
}
