import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apiDirectory,
  apiEnvironment,
  migrate,
  startDatabase,
  startStorage,
} from '../../apps/api/test/support/containers.ts';
import { freePort, waitForHttp } from '../../apps/api/test/support/process.ts';
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
  /**
   * Stops everything that was started and removes the containers. Every call
   * returns the same promise, so a second caller (a signal handler while the
   * normal cleanup runs) waits for the cleanup to finish.
   */
  stop: () => Promise<void>;
}

interface Cleanup {
  /** Registers how to stop something that was just started. */
  add: (stopOne: () => Promise<unknown>) => void;
  /** Stops everything registered, newest first; every call returns the same promise. */
  run: () => Promise<void>;
}

function createCleanup(): Cleanup {
  const stops: Array<() => Promise<unknown>> = [];
  let running: Promise<void> | undefined;
  return {
    add: (stopOne) => stops.push(stopOne),
    run: () => {
      running ??= (async () => {
        for (const stopOne of stops.splice(0).reverse()) {
          await stopOne().catch((error: unknown) => console.error(error));
        }
      })();
      return running;
    },
  };
}

/**
 * Starts a throwaway copy of the whole system on random ports: PostgreSQL and
 * SeaweedFS in containers, the migrations, the built api (apps/api/dist) and
 * the built web (apps/web/dist) behind a server that forwards /api like the
 * Vercel rewrite. Both apps must be built first.
 */
export async function startEnvironment(options: EnvironmentOptions): Promise<Environment> {
  const cleanup = createCleanup();
  try {
    const [database, storage] = await Promise.allSettled([startDatabase(), startStorage()]);
    if (database.status === 'fulfilled') {
      cleanup.add(() => database.value.stop());
    }
    if (storage.status === 'fulfilled') {
      cleanup.add(() => storage.value.container.stop());
    }
    if (database.status === 'rejected') {
      throw database.reason;
    }
    if (storage.status === 'rejected') {
      throw storage.reason;
    }
    const databaseUrl = database.value.getConnectionUri();
    await migrate(databaseUrl);

    // The api's errors go straight to this process's stderr, so its output
    // is not kept in memory for the length of the tests.
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
    cleanup.add(() => stopProcess(api));
    const exited = new Promise<number | null>((resolveExit) => api.on('exit', resolveExit));
    await waitForHttp({ exited }, apiPort);

    const web = await startWebServer({
      root: webRoot,
      apiOrigin: `http://127.0.0.1:${apiPort}`,
      host: options.webHost,
    });
    cleanup.add(() => web.close());

    return { baseUrl: `http://127.0.0.1:${web.port}`, stop: cleanup.run };
  } catch (error) {
    await cleanup.run();
    throw error;
  }
}

/**
 * Ends the child and waits for it to exit. A child that already exited,
 * normally or from a signal such as the Ctrl-C its terminal also sent it,
 * has nothing left to wait for.
 */
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
