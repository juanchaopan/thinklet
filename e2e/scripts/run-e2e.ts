import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startEnvironment } from '../support/environment.ts';

// `task test-e2e`: starts a throwaway environment, runs `playwright test`
// against it with the given arguments (for example `--project=chromium`),
// then removes the environment, also when the tests fail or are interrupted.

const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const configFile = fileURLToPath(new URL('../playwright.config.ts', import.meta.url));

const environment = await startEnvironment({ webHost: '127.0.0.1' });
const stopOnSignal = () => void environment.stop().then(() => process.exit(130));
process.once('SIGINT', stopOnSignal);
process.once('SIGTERM', stopOnSignal);

let exitCode = 1;
try {
  const playwright = spawn(
    process.execPath,
    [playwrightCli, 'test', '--config', configFile, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, BASE_URL: environment.baseUrl } },
  );
  const [code] = (await once(playwright, 'exit')) as [number | null];
  exitCode = code ?? 1;
} finally {
  await environment.stop();
}
process.exit(exitCode);
