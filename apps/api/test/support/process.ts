import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Helpers for tests that run the api as a separate process. They import
// nothing but Node.js, so the end-to-end environment (e2e/support), which
// Node.js runs directly, can share them with the api's own tests.

/**
 * How long a starting api may take to answer. A cold start takes about ten
 * seconds and several times that on a busy machine; this is a bound on a
 * start that never comes, not a measure of a normal one. It stays below the
 * hook timeout of the container test subjects, which also covers starting
 * the containers.
 */
const START_DEADLINE_MS = 90_000;
/** How long one attempt to reach the api may take before the next one. */
const ATTEMPT_TIMEOUT_MS = 2_000;
/** The pause between attempts while nothing listens on the port yet. */
const RETRY_DELAY_MS = 200;

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
 * Waits until the api answers HTTP on the port. It fails as soon as the
 * process exits, and when the process neither answers nor exits within
 * START_DEADLINE_MS. Any answer counts, so the path asked for is one the api
 * does not serve and no health check runs while it starts.
 */
export async function waitForHttp(running: WatchedProcess, port: number): Promise<void> {
  const details = () => (running.output ? `:\n${running.output()}` : '');
  const stopped = new AbortController();
  try {
    const outcome = await Promise.race([
      running.exited.then((code) => ({ exitCode: code })),
      firstAnswer(port, stopped.signal).then((answered) => ({ answered })),
    ]);
    if ('exitCode' in outcome) {
      throw new Error(`The api exited with code ${outcome.exitCode}${details()}`);
    }
    if (!outcome.answered) {
      throw new Error(
        `The api did not answer on port ${port} within ${START_DEADLINE_MS / 1000} s${details()}`,
      );
    }
  } finally {
    stopped.abort();
  }
}

/**
 * Asks the port until it answers (true), the deadline passes (false) or the
 * signal stops the attempts.
 */
async function firstAnswer(port: number, stop: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + START_DEADLINE_MS;
  while (!stop.aborted && Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/unknown`, {
        signal: AbortSignal.any([stop, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
      });
      return true;
    } catch {
      await delay(RETRY_DELAY_MS, undefined, { signal: stop }).catch(() => undefined);
    }
  }
  return false;
}
