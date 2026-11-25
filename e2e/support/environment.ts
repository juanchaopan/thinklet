import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAuthingStub } from '../../apps/api/test/support/authing-stub.ts';
import {
  accessTo,
  apiDirectory,
  apiEnvironment,
  importBuiltCovers,
  migrate,
  startServices,
  TEST_AUTHING,
  TEST_CLIENT_IP_HEADER,
} from '../../apps/api/test/support/containers.ts';
import { freePort, waitForHttp } from '../../apps/api/test/support/process.ts';
import { loopbackCertificate } from './certificate.ts';
import { startWebServer } from './web-server.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = join(repositoryRoot, 'apps', 'web', 'dist', 'web', 'browser');

/**
 * The host name of the web origin. A local Docker's containers, the mock
 * identity provider among them, are reached at `localhost` too, so the
 * provider's login page and the site are one site to the browser:
 * Playwright's WebKit cannot follow a navigation from another site into an
 * origin whose certificate it does not trust, as the HTTPS origin's
 * self-signed one is. The web server listens on the loopback, where
 * `localhost` points.
 */
const WEB_HOST_NAME = 'localhost';

/**
 * How long after deleting a user the Authing stand-in reports it to the
 * api's webhook, as Authing does once it is done, so the api has finished
 * its own deletion first.
 */
const AUTHING_REPORT_DELAY_MS = 1_000;

export interface EnvironmentOptions {
  /**
   * The interface the web server listens on. Tests in this process use the
   * loopback; a scanner in a container needs every interface.
   */
  webHost: string;
  /**
   * Whether the web origin is HTTPS, with a self-signed certificate made for
   * this run. The login cookies are Secure, and WebKit sends a Secure cookie
   * only over HTTPS, even to the loopback, so browsers that sign in need it;
   * their clients must ignore certificate errors. Without it the origin is
   * plain HTTP.
   */
  https?: boolean;
}

export interface Environment {
  /** The web origin, which also forwards /api to the api. */
  baseUrl: string;
  /** The mock identity provider the api signs in through: its issuer and the api's client id. */
  identityProvider: { issuer: string; clientId: string };
  /**
   * The address of the environment's database, for the few tests that set
   * up what no user can do any more through the site, such as a book a
   * family acquired before it left the library.
   */
  databaseUrl: string;
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
 * Starts a throwaway copy of the whole system on random ports: PostgreSQL,
 * SeaweedFS, Valkey (for Redis) and the mock OIDC provider in containers,
 * the Authing stand-in for the management API and its webhook, the
 * migrations and the cover import of the repository's content/books/ (the
 * built apps/api/dist/rebuild.js), the built web (apps/web/dist) behind a
 * server that forwards /api like the Vercel rewrite, writing the client's
 * address into the header the api reads it from, and the built api
 * (apps/api/dist) with that server's origin as its own, so the login's
 * callback, the logout's return address and the allowed Origin all follow
 * the web origin. Both apps must be built first.
 */
export async function startEnvironment(options: EnvironmentOptions): Promise<Environment> {
  const cleanup = createCleanup();
  try {
    const services = await startServices();
    cleanup.add(services.stop);
    const databaseUrl = services.database.getConnectionUri();
    await migrate(databaseUrl);
    await importBuiltCovers(databaseUrl, services.storage);

    // The web server starts first, so the api gets the origin it is reached
    // at; nothing calls /api before the api answers below.
    const apiPort = await freePort();
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const web = await startWebServer({
      root: webRoot,
      apiOrigin,
      host: options.webHost,
      clientIpHeader: TEST_CLIENT_IP_HEADER,
      ...(options.https ? { tls: loopbackCertificate() } : {}),
    });
    cleanup.add(() => web.close());
    const baseUrl = `${options.https ? 'https' : 'http'}://${WEB_HOST_NAME}:${web.port}`;

    const authing = await startAuthingStub({
      ...TEST_AUTHING,
      webhookUrl: `${apiOrigin}/api/webhooks/authing`,
      delivery: AUTHING_REPORT_DELAY_MS,
    });
    cleanup.add(() => authing.close());

    // The api's errors go straight to this process's stderr, so its output
    // is not kept in memory for the length of the tests.
    const api = spawn(process.execPath, [join(apiDirectory, 'dist', 'main.js')], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        ...apiEnvironment(accessTo(services, authing.origin), baseUrl),
        PORT: String(apiPort),
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    cleanup.add(() => stopProcess(api));
    const exited = new Promise<number | null>((resolveExit) => api.on('exit', resolveExit));
    await waitForHttp({ exited }, apiPort);

    return {
      baseUrl,
      identityProvider: { issuer: services.oidc.issuer, clientId: services.oidc.clientId },
      databaseUrl,
      stop: cleanup.run,
    };
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
