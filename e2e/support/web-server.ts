import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  request,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { WEB_SECURITY_HEADERS } from '../../apps/web/scripts/security-headers.ts';
import type { TlsCredentials } from './certificate.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * How long an idle keep-alive connection from a test stays open: longer than
 * any test, so a test's request context never sends a request on a
 * connection the server is closing at that moment, which fails it with
 * ECONNRESET. The connections are closed when the server closes.
 */
const KEEP_ALIVE_MS = 10 * 60 * 1000;

export interface WebServerOptions {
  /** The built web app (`apps/web/dist/web/browser`). */
  root: string;
  /** Where `/api` requests go, e.g. `http://127.0.0.1:3000`. */
  apiOrigin: string;
  /** The interface to listen on; the port is chosen by the OS. */
  host: string;
  /** The key and certificate to serve HTTPS with; without them the server speaks plain HTTP. */
  tls?: TlsCredentials;
}

export interface StartedWebServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Serves the built web app the way the `thinklet-web` Vercel project does:
 * static files, `/api` and `/api/*` forwarded to the api, and `index.html`
 * for every other path so the router can handle it. Every response this
 * server answers itself, errors included, carries the web security headers
 * from the same list as vercel.json; a forwarded `/api` response keeps only
 * the api's own. A request that fails is answered with 502 (api) or 500
 * (file) when nothing was sent yet, and cut off otherwise.
 */
export async function startWebServer(options: WebServerOptions): Promise<StartedWebServer> {
  const handle: RequestListener = (incoming, outgoing) => {
    // Only the path and query of the request line count: an absolute-form
    // request line (`GET http://other-host/api/...`) names no other host.
    const { pathname, search } = new URL(incoming.url ?? '/', 'http://localhost');
    const toApi = pathname === '/api' || pathname.startsWith('/api/');
    if (!toApi) {
      setWebSecurityHeaders(outgoing);
    }
    const handled = toApi
      ? forward(incoming, outgoing, apiTarget(options.apiOrigin, pathname, search))
      : serveFile(pathname, outgoing, options.root);
    handled.catch(() => {
      if (!outgoing.headersSent) {
        // The error status comes from this server, not from the api, so it
        // carries the web's headers even for an `/api` request.
        setWebSecurityHeaders(outgoing);
        outgoing.writeHead(toApi ? 502 : 500);
      }
      outgoing.end();
    });
  };
  const server = options.tls ? createHttpsServer(options.tls, handle) : createHttpServer(handle);
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  await new Promise<void>((resolve) => server.listen(0, options.host, resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Sets the web security headers on a response whose status is not written
 * yet, so writeHead merges them into whatever status it sends.
 */
function setWebSecurityHeaders(outgoing: ServerResponse): void {
  for (const [name, value] of Object.entries(WEB_SECURITY_HEADERS)) {
    outgoing.setHeader(name, value);
  }
}

/** The api URL for a request: always the configured origin, with the request's path and query. */
function apiTarget(apiOrigin: string, pathname: string, search: string): URL {
  const target = new URL(apiOrigin);
  target.pathname = pathname;
  target.search = search;
  return target;
}

async function serveFile(path: string, outgoing: ServerResponse, root: string): Promise<void> {
  let file = normalize(join(root, decodeURIComponent(path)));
  if (file !== root && !file.startsWith(root + sep)) {
    outgoing.writeHead(404).end();
    return;
  }
  const found = await stat(file).catch(() => undefined);
  if (!found?.isFile()) {
    file = join(root, 'index.html');
  }
  // The file is opened before the status is written, so a file that cannot
  // be read still gets an error status.
  const content = createReadStream(file);
  await once(content, 'open');
  outgoing.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
  });
  await pipeline(content, outgoing);
}

/**
 * Forwards a request to the api on a connection of its own: a pooled
 * connection the api is just closing as idle would fail the request with a
 * 502 that no test caused.
 */
function forward(incoming: IncomingMessage, outgoing: ServerResponse, target: URL) {
  return new Promise<void>((resolve, reject) => {
    const proxied = request(
      target,
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: target.host },
        agent: false,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        pipeline(response, outgoing).then(resolve, reject);
      },
    );
    proxied.on('error', reject);
    incoming.pipe(proxied);
  });
}
