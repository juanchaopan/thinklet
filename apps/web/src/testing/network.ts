import { setupWorker } from 'msw/browser';

/**
 * Stubs the api in component tests. A test adds the responses it needs with
 * `worker.use(http.get('/api/...', () => HttpResponse.json(...)))`; they are
 * removed after each test (see setup.ts). Other requests (the test page's own
 * modules and assets) pass through. The worker script is served by the
 * `msw/vite` plugin in vitest.config.ts.
 */
export const worker = setupWorker();

const unhandledApiRequests: string[] = [];

/**
 * Returns and forgets the `/api/*` requests that had no stub. A request
 * without a stub fails like a network error, and setup.ts fails the test
 * that made it, so no component test depends on a running api.
 */
export function takeUnhandledApiRequests(): string[] {
  return unhandledApiRequests.splice(0);
}

export async function startWorker(): Promise<void> {
  await worker.start({
    quiet: true,
    onUnhandledFrame({ frame }) {
      // HTTP frames carry the request; WebSocket frames carry a connection.
      const request = (frame.data as { request?: unknown }).request;
      if (request instanceof Request && new URL(request.url).pathname.startsWith('/api/')) {
        unhandledApiRequests.push(`${request.method} ${new URL(request.url).pathname}`);
        // MSW answers a request with the Response its handler throws; a
        // Response.error() reaches the page as a network error.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw Response.error();
      }
    },
  });
}
