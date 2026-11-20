import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiDirectory } from './containers.js';

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

/** A TCP port on this machine that nothing listens on. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') {
    throw new Error('No free port');
  }
  return address.port;
}

export interface RunningProcess {
  child: ChildProcess;
  /** Everything the process wrote to stdout and stderr so far. */
  output: () => string;
  /** Resolves with the exit code once the process has exited. */
  exited: Promise<number | null>;
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

/** Waits until the process answers HTTP on the port, failing if it exits first. */
export async function waitForHttp(running: RunningProcess, port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  let exitCode: number | null | undefined;
  void running.exited.then((code) => (exitCode = code));
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new Error(`The api exited with code ${exitCode}:\n${running.output()}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/api/unknown`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`The api did not answer on port ${port}:\n${running.output()}`);
}
