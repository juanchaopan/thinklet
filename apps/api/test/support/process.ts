import { createServer } from 'node:net';

// Helpers for tests that run the api as a separate process. They import
// nothing but Node.js, so the end-to-end environment (e2e/support), which
// Node.js runs directly, can share them with the api's own tests.

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

/** What waitForHttp needs to know of a started api process. */
export interface WatchedProcess {
  /** Resolves with the exit code once the process has exited. */
  exited: Promise<number | null>;
  /** Everything the process wrote so far, when its output is captured. */
  output?: () => string;
}

/**
 * Waits until the api answers HTTP on the port, failing if it exits first.
 * Any answer counts, so the path asked for is one the api does not serve and
 * no health check runs while it starts.
 */
export async function waitForHttp(running: WatchedProcess, port: number): Promise<void> {
  const details = () => (running.output ? `:\n${running.output()}` : '');
  const deadline = Date.now() + 30_000;
  let exitCode: number | null | undefined;
  void running.exited.then((code) => (exitCode = code));
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new Error(`The api exited with code ${exitCode}${details()}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/api/unknown`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`The api did not answer on port ${port}${details()}`);
}
