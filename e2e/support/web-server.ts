import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';

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

export interface WebServerOptions {
  /** The built web app (`apps/web/dist/web/browser`). */
  root: string;
  /** Where `/api` requests go, e.g. `http://127.0.0.1:3000`. */
  apiOrigin: string;
  /** The interface to listen on; the port is chosen by the OS. */
  host: string;
}

export interface StartedWebServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Serves the built web app the way the `thinklet-web` Vercel project does:
 * static files, `/api` and `/api/*` forwarded to the api, and `index.html`
 * for every other path so the router can handle it.
 */
export async function startWebServer(options: WebServerOptions): Promise<StartedWebServer> {
  const server = createServer((incoming, outgoing) => {
    const path = new URL(incoming.url ?? '/', 'http://localhost').pathname;
    const handled =
      path === '/api' || path.startsWith('/api/')
        ? forward(incoming, outgoing, options.apiOrigin)
        : serveFile(path, outgoing, options.root);
    handled.catch(() => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(502);
      }
      outgoing.end();
    });
  });
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
  outgoing.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(outgoing);
}

function forward(incoming: IncomingMessage, outgoing: ServerResponse, apiOrigin: string) {
  return new Promise<void>((resolve, reject) => {
    const target = new URL(incoming.url ?? '/', apiOrigin);
    const proxied = request(
      target,
      { method: incoming.method, headers: { ...incoming.headers, host: target.host } },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing).on('finish', resolve);
      },
    );
    proxied.on('error', reject);
    incoming.pipe(proxied);
  });
}
