import type { NestExpressApplication } from '@nestjs/platform-express';
import type { CoverImportSummary } from '../../src/modules/book/cover-import.service.js';
import { startAuthingStub, type AuthingStub } from './authing-stub.js';
import {
  accessTo,
  apiEnvironment,
  bookContentDirectory,
  coverImportEnvironment,
  importBuiltCovers,
  migrate,
  spawnBuiltEntry,
  startServices,
  TEST_AUTHING,
  type BuiltProcess,
  type StartedServices,
  type StorageAccess,
} from './containers.js';
import { freePort, waitForHttp, type WatchedProcess } from './process.js';

/** The path of Authing's webhook on the api. */
const WEBHOOK_PATH = '/api/webhooks/authing';

/**
 * Starts the Nest application in this test process with the given
 * environment. The configuration is read when the application module is
 * first imported, so the module registry is reset for every application.
 */
export async function startApp(
  environment: Record<string, string>,
): Promise<NestExpressApplication> {
  Object.assign(process.env, environment);
  vi.resetModules();
  const { createApp } = await import('../../src/create-app.js');
  const app = await createApp();
  await app.init();
  return app;
}

/**
 * Runs the cover import in this test process, as rebuild.ts runs it, from
 * the given book folders into the database and storage. Like startApp it
 * sets the environment and resets the module registry first, so the
 * import reads this configuration. A failure is thrown as it is.
 */
export async function importCovers(
  databaseUrl: string,
  storage: StorageAccess,
  contentDirectory = bookContentDirectory,
): Promise<CoverImportSummary> {
  Object.assign(process.env, coverImportEnvironment(databaseUrl, storage, contentDirectory));
  vi.resetModules();
  const { NestFactory } = await import('@nestjs/core');
  const { RebuildModule } = await import('../../src/rebuild.module.js');
  const { CoverImportService } = await import('../../src/modules/book/cover-import.service.js');
  const context = await NestFactory.createApplicationContext(RebuildModule, {
    abortOnError: false,
    logger: false,
  });
  try {
    return await context.get(CoverImportService).importCovers(contentDirectory);
  } finally {
    await context.close();
  }
}

/**
 * Starts the Authing stand-in with the tests' user pool and webhook secret.
 * It holds its reports to the webhook until a test delivers them, so a test
 * decides when Authing's notification arrives.
 */
export function startTestAuthingStub(): Promise<AuthingStub> {
  return startAuthingStub({ ...TEST_AUTHING, delivery: 'manual' });
}

export interface AppWithServices {
  app: NestExpressApplication;
  services: StartedServices;
  /** The Authing stand-in the application deletes accounts at, reporting to its webhook. */
  authing: AuthingStub;
  /** The connection URL of the migrated database the application uses. */
  databaseUrl: string;
  /** Closes the application, the stand-in and removes the containers. */
  stop: () => Promise<void>;
}

/**
 * Starts the throwaway database, storage, Redis and OIDC provider and the
 * Authing stand-in, migrates the database, imports the repository's covers
 * and starts the application against them. The application listens on the
 * loopback, so the stand-in can call its webhook as Authing would.
 */
export async function startAppWithServices(): Promise<AppWithServices> {
  const services = await startServices();
  let authing: AuthingStub | undefined;
  try {
    authing = await startTestAuthingStub();
    const databaseUrl = services.database.getConnectionUri();
    await migrate(databaseUrl);
    await importCovers(databaseUrl, services.storage);
    const app = await startApp(apiEnvironment(accessTo(services, authing.origin)));
    await app.listen(0, '127.0.0.1');
    authing.reportTo(`${await app.getUrl()}${WEBHOOK_PATH}`);
    const started = authing;
    const stop = async () => {
      await app.close();
      await started.close();
      await services.stop();
    };
    return { app, services, authing, databaseUrl, stop };
  } catch (error) {
    await authing?.close();
    await services.stop();
    throw error;
  }
}

export interface AppWithoutServices {
  app: NestExpressApplication;
  /** The port the database, the bucket, Redis and the OIDC issuer point at, on which nothing listens. */
  closedPort: number;
}

/**
 * Starts the application with the database, the bucket, Redis and the OIDC
 * issuer pointing at a closed port, for tests that need no container: every
 * health check fails at once, so GET /api/health answers 503.
 */
export async function startAppWithoutServices(): Promise<AppWithoutServices> {
  const closedPort = await freePort();
  const app = await startApp(
    apiEnvironment({
      databaseUrl: `postgresql://thinklet:not-used@127.0.0.1:${closedPort}/thinklet`,
      storage: {
        endpoint: `http://127.0.0.1:${closedPort}`,
        bucket: 'bucket',
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
      },
      oidc: {
        issuer: `http://127.0.0.1:${closedPort}/default`,
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      redisUrl: `redis://127.0.0.1:${closedPort}`,
    }),
  );
  return { app, closedPort };
}

export type RunningProcess = BuiltProcess & WatchedProcess;

/**
 * Runs the built long-running entry point (dist/main.js) as a separate
 * process with only the given variables, plus what the OS needs to start it.
 */
export function runBuiltApp(environment: Record<string, string>): RunningProcess {
  const { child, output } = spawnBuiltEntry('main.js', environment);
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  return { child, output, exited };
}

export interface BuiltAppWithServices {
  services: StartedServices;
  /** The Authing stand-in the built api deletes accounts at, reporting to its webhook. */
  authing: AuthingStub;
  /** The address the built api listens on. */
  api: string;
  /** Stops the api, waits for it to exit and returns everything it wrote. */
  stopApp: () => Promise<string>;
  /** Stops the api if it still runs, closes the stand-in and removes the containers. */
  stop: () => Promise<void>;
}

/**
 * Migrates the services, imports the repository's covers with the built
 * import, runs the built api against them and the stand-in and waits until
 * it answers.
 */
async function runMigratedBuiltApp(
  services: StartedServices,
  authing: AuthingStub,
): Promise<{ running: RunningProcess; port: number }> {
  const databaseUrl = services.database.getConnectionUri();
  await migrate(databaseUrl);
  await importBuiltCovers(databaseUrl, services.storage);
  const port = await freePort();
  const running = runBuiltApp({
    ...apiEnvironment(accessTo(services, authing.origin)),
    PORT: String(port),
  });
  try {
    await waitForHttp(running, port);
  } catch (error) {
    running.child.kill();
    throw error;
  }
  return { running, port };
}

/**
 * Starts the throwaway services and the Authing stand-in, migrates the
 * database and runs the built api against them, for tests that read what
 * the api writes, as the platform's log collector would.
 */
export async function startBuiltAppWithServices(): Promise<BuiltAppWithServices> {
  const services = await startServices();
  let authing: AuthingStub | undefined;
  let started: { running: RunningProcess; port: number };
  try {
    authing = await startTestAuthingStub();
    started = await runMigratedBuiltApp(services, authing);
  } catch (error) {
    await authing?.close();
    await services.stop();
    throw error;
  }
  const { running, port } = started;
  const api = `http://127.0.0.1:${port}`;
  authing.reportTo(`${api}${WEBHOOK_PATH}`);
  const stand = authing;
  return {
    services,
    authing: stand,
    api,
    stopApp: async () => {
      running.child.kill();
      await running.exited;
      return running.output();
    },
    stop: async () => {
      running.child.kill();
      await stand.close();
      await services.stop();
    },
  };
}
