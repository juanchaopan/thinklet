import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiDirectory,
  apiEnvironment,
  migrate,
  startServices,
  type StartedServices,
} from './containers.js';
import { freePort, waitForHttp, type WatchedProcess } from './process.js';

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

export interface AppWithServices {
  app: NestExpressApplication;
  services: StartedServices;
  /** The connection URL of the migrated database the application uses. */
  databaseUrl: string;
  /** Closes the application and removes the containers. */
  stop: () => Promise<void>;
}

/**
 * Starts the throwaway database, storage and OIDC provider, migrates the
 * database and starts the application against them.
 */
export async function startAppWithServices(): Promise<AppWithServices> {
  const services = await startServices();
  try {
    const databaseUrl = services.database.getConnectionUri();
    await migrate(databaseUrl);
    const app = await startApp(apiEnvironment(databaseUrl, services.storage, services.oidc));
    const stop = async () => {
      await app.close();
      await services.stop();
    };
    return { app, services, databaseUrl, stop };
  } catch (error) {
    await services.stop();
    throw error;
  }
}

export interface AppWithoutServices {
  app: NestExpressApplication;
  /** The port the database, the bucket and the OIDC issuer point at, on which nothing listens. */
  closedPort: number;
}

/**
 * Starts the application with the database, the bucket and the OIDC issuer
 * pointing at a closed port, for tests that need no container: every health
 * check fails at once, so GET /api/health answers 503.
 */
export async function startAppWithoutServices(): Promise<AppWithoutServices> {
  const closedPort = await freePort();
  const app = await startApp(
    apiEnvironment(
      `postgresql://thinklet:not-used@127.0.0.1:${closedPort}/thinklet`,
      {
        endpoint: `http://127.0.0.1:${closedPort}`,
        bucket: 'bucket',
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
      },
      {
        issuer: `http://127.0.0.1:${closedPort}/default`,
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    ),
  );
  return { app, closedPort };
}

export interface RunningProcess extends WatchedProcess {
  child: ChildProcess;
  /** Everything the process wrote to stdout and stderr so far. */
  output: () => string;
}

/**
 * Runs the built long-running entry point (dist/main.js) as a separate
 * process with only the given variables, plus what the OS needs to start it.
 */
export function runBuiltApp(environment: Record<string, string>): RunningProcess {
  const chunks: Buffer[] = [];
  const child = spawn(process.execPath, [join(apiDirectory, 'dist', 'main.js')], {
    cwd: apiDirectory,
    env: {
      PATH: process.env['PATH'] ?? '',
      SYSTEMROOT: process.env['SYSTEMROOT'] ?? '',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  return { child, output: () => Buffer.concat(chunks).toString('utf8'), exited };
}

export interface BuiltAppWithServices {
  services: StartedServices;
  /** The address the built api listens on. */
  api: string;
  /** Stops the api, waits for it to exit and returns everything it wrote. */
  stopApp: () => Promise<string>;
  /** Stops the api if it still runs and removes the containers. */
  stop: () => Promise<void>;
}

/** Runs the built api against the migrated services and waits until it answers. */
async function runMigratedBuiltApp(
  services: StartedServices,
): Promise<{ running: RunningProcess; port: number }> {
  const databaseUrl = services.database.getConnectionUri();
  await migrate(databaseUrl);
  const port = await freePort();
  const running = runBuiltApp({
    ...apiEnvironment(databaseUrl, services.storage, services.oidc),
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
 * Starts the throwaway services, migrates the database and runs the built
 * api against them, for tests that read what the api writes, as the
 * platform's log collector would.
 */
export async function startBuiltAppWithServices(): Promise<BuiltAppWithServices> {
  const services = await startServices();
  let started: { running: RunningProcess; port: number };
  try {
    started = await runMigratedBuiltApp(services);
  } catch (error) {
    await services.stop();
    throw error;
  }
  const { running, port } = started;
  return {
    services,
    api: `http://127.0.0.1:${port}`,
    stopApp: async () => {
      running.child.kill();
      await running.exited;
      return running.output();
    },
    stop: async () => {
      running.child.kill();
      await services.stop();
    },
  };
}
