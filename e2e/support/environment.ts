import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apiDirectory,
  apiEnvironment,
  migrate,
  startDatabase,
  startStorage,
} from '../../apps/api/test/support/containers.ts';
import { startWebServer } from './web-server.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = join(repositoryRoot, 'apps', 'web', 'dist', 'web', 'browser');

export interface EnvironmentOptions {
  /**
   * The interface the web server listens on. Tests in this process use the
   * loopback; a scanner in a container needs every interface.
   */
  webHost: string;
}

export interface Environment {
  /** The web origin, which also forwards /api to the api. */
  baseUrl: string;
  /** Stops everything that was started and removes the containers; safe to call twice. */
  stop: () => Promise<void>;
}

/**
 * Starts a throwaway copy of the whole system on random ports: PostgreSQL and
 * SeaweedFS in containers, the migrations, the built api (apps/api/dist) and
 * the built web (apps/web/dist) behind a server that forwards /api like the
 * Vercel rewrite. Both apps must be built first.
 */
export async function startEnvironment(options: EnvironmentOptions): Promise<Environment> {
  const stops: Array<() => Promise<unknown>> = [];
  const stop = async () => {
    for (const stopOne of stops.splice(0).reverse()) {
      await stopOne().catch((error: unknown) => console.error(error));
    }
  };
  try {
    const [database, storage] = await Promise.allSettled([startDatabase(), startStorage()]);
    if (database.status === 'fulfilled') {
      stops.push(() => database.value.stop());
    }
    if (storage.status === 'fulfilled') {
      stops.push(() => storage.value.container.stop());
    }
    if (database.status === 'rejected') {
      throw database.reason;
    }
    if (storage.status === 'rejected') {
      throw storage.reason;
    }
    const databaseUrl = database.value.getConnectionUri();
    await migrate(databaseUrl);

    const apiPort = await freePort();
    const api = spawn(process.execPath, [join(apiDirectory, 'dist', 'main.js')], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        ...apiEnvironment(databaseUrl, storage.value),
        PORT: String(apiPort),
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    stops.push(() => stopProcess(api));
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    await waitForApi(api, apiOrigin);

    const web = await startWebServer({ root: webRoot, apiOrigin, host: options.webHost });
    stops.push(() => web.close());

    return { baseUrl: `http://127.0.0.1:${web.port}`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  if (address === null || typeof address === 'string') {
    throw new Error('No free port');
  }
  return address.port;
}

async function waitForApi(api: ChildProcess, origin: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) {
      throw new Error(`The api exited with code ${api.exitCode}`);
    }
    try {
      await fetch(`${origin}/api/health`);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
  throw new Error(`The api did not answer at ${origin}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
