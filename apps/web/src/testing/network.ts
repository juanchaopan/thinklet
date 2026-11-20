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

let started: Promise<void> | undefined;

/** Whether a path belongs to the api: `/api` itself or anything below it. */
function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Returns and forgets the `/api` and `/api/*` requests that had no stub. A
 * request without a stub fails like a network error, and setup.ts fails the
 * test that made it, so no component test depends on a running api.
 */
export function takeUnhandledApiRequests(): string[] {
  return unhandledApiRequests.splice(0);
}

/**
 * Starts the worker once per test page. Test files are not isolated (the
 * Angular unit-test builder's default), so several files can run one after
 * another on the same page: they share this module and its worker, while
 * setup.ts calls this before each of them. Every call after the first returns
 * the same start.
 */
export function startWorker(): Promise<void> {
  started ??= start();
  return started;
}

async function start(): Promise<void> {
  await worker.start({
    quiet: true,
    onUnhandledFrame({ frame }) {
      // HTTP frames carry the request; WebSocket frames carry a connection.
      const request = (frame.data as { request?: unknown }).request;
      if (!(request instanceof Request)) {
        return;
      }
      const { pathname } = new URL(request.url);
      if (isApiPath(pathname)) {
        unhandledApiRequests.push(`${request.method} ${pathname}`);
        // MSW answers a request with the Response its handler throws; a
        // Response.error() reaches the page as a network error.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw Response.error();
      }
    },
  });
}
