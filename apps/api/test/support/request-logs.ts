/** A logged request as the request log writes it. */
export interface LoggedRequest {
  url?: unknown;
  headers?: Record<string, unknown>;
}

/** Every request the output of the api logged, one JSON entry per line. */
export function loggedRequests(output: string): LoggedRequest[] {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { req?: LoggedRequest })
    .flatMap((entry) => (entry.req === undefined ? [] : [entry.req]));
}

/** The URL every logged request was written with. */
export function loggedUrls(output: string): string[] {
  return loggedRequests(output).flatMap((req) => (typeof req.url === 'string' ? [req.url] : []));
}
