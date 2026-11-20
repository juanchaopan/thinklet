const URL_PATTERN = /[a-z][a-z\d+.-]*:\/\/\S+/gi;

export interface ErrorDescription {
  name: string;
  message: string;
  code?: string;
  status?: number;
}

/**
 * Turns a thrown value into fields that are safe to log: the error name,
 * code, HTTP status and message, with any URL in the message replaced, so
 * connection strings and endpoints never reach the logs. Stack traces and
 * nested causes are left out because they can carry the same details.
 */
export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: 'A non-error value was thrown' };
  }

  const description: ErrorDescription = {
    name: error.name,
    message: error.message.replace(URL_PATTERN, '[url]'),
  };
  const { code, $metadata } = error as { code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (typeof code === 'string') {
    description.code = code;
  }
  if (typeof $metadata?.httpStatusCode === 'number') {
    description.status = $metadata.httpStatusCode;
  }
  return description;
}
