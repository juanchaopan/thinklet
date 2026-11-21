import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The header that carries a request's id back to the caller. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

type TaggedRequest = IncomingMessage & { id?: unknown };

/**
 * The id of the request, the one its log lines carry and its error response
 * names. pino-http gives each request one as it is logged; a request
 * answered before that (such as a path outside the api) gets a fresh one
 * here, returned in the X-Request-Id header like the others.
 */
export function requestIdOf(request: IncomingMessage, response: ServerResponse): string {
  const tagged = request as TaggedRequest;
  if (typeof tagged.id === 'string') {
    return tagged.id;
  }
  const id = randomUUID();
  tagged.id = id;
  if (!response.headersSent) {
    response.setHeader(REQUEST_ID_HEADER, id);
  }
  return id;
}
