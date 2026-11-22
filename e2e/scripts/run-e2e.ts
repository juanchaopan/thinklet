import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startEnvironment } from '../support/environment.ts';

// `task test-e2e`: starts a throwaway environment, runs `playwright test`
// against it with the given arguments (for example `--project=chromium`),
// then removes the environment, also when the tests fail or are interrupted.
// The tests learn the web origin and the identity provider of that
// environment from BASE_URL, TEST_OIDC_ISSUER and TEST_OIDC_CLIENT_ID. The
// web origin is HTTPS with a certificate made for this run, so every browser
// keeps and sends the Secure login cookies; TEST_IGNORE_HTTPS_ERRORS tells
// the browsers to accept that certificate.

const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const configFile = fileURLToPath(new URL('../playwright.config.ts', import.meta.url));

const environment = await startEnvironment({ webHost: '127.0.0.1', https: true });
const stopOnSignal = () => void environment.stop().then(() => process.exit(130));
process.once('SIGINT', stopOnSignal);
process.once('SIGTERM', stopOnSignal);

let exitCode: number;
try {
  const playwright = spawn(
    process.execPath,
    [playwrightCli, 'test', '--config', configFile, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_URL: environment.baseUrl,
        TEST_OIDC_ISSUER: environment.identityProvider.issuer,
        TEST_OIDC_CLIENT_ID: environment.identityProvider.clientId,
        TEST_IGNORE_HTTPS_ERRORS: 'true',
      },
    },
  );
  const [code] = (await once(playwright, 'exit')) as [number | null];
  exitCode = code ?? 1;
} finally {
  await environment.stop();
}
process.exit(exitCode);
