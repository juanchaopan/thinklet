import { availableParallelism, freemem } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

// End-to-end and smoke tests. They run against BASE_URL, the web origin that
// also forwards /api to the api:
// - `task test-e2e` starts a throwaway environment and sets it;
// - `task test-smoke BASE_URL=...` points it at a deployed environment and
//   runs only the tests tagged @smoke (or @production-safe).
// TEST_OIDC_ISSUER and TEST_OIDC_CLIENT_ID name the identity provider the
// site signs in through: `task test-e2e` sets them to its mock provider, and
// a smoke run that sets them also checks that the login goes to that
// provider with that client id.
// TEST_IGNORE_HTTPS_ERRORS=true lets the browsers accept the self-signed
// certificate of the throwaway environment, which `task test-e2e` serves
// over HTTPS; a smoke run leaves it unset, so a deployed site's certificate
// is checked.
// Chromium runs on every PR; Firefox, WebKit and a touch phone run before a
// release (`task test-e2e-all-browsers`).
const baseURL = process.env['BASE_URL'];
if (!baseURL) {
  throw new Error('Set BASE_URL to the web origin to test (the tasks set it)');
}

/**
 * The memory one Chromium worker takes at its peak, rounded up: its browser
 * with the pages of a test of two parents (about 650 MB measured) and its
 * Node process (about 200 MB).
 */
const MEMORY_PER_WORKER = 1024 ** 3;

/**
 * How many tests run at a time: Playwright's default of one per two CPU
 * threads, but no more than the memory free when the run starts can hold,
 * and at least one. With more browsers than that, the machine runs out of
 * memory and pages heavily: pages stall past the test timeout, and tests
 * fail in steps that have nothing to do with them. The environment of
 * `task test-e2e` is already running when this is read, so its containers
 * and api are counted. `--workers` still overrides it.
 */
const WORKERS = Math.max(
  1,
  Math.min(Math.floor(availableParallelism() / 2), Math.floor(freemem() / MEMORY_PER_WORKER)),
);

/**
 * How many tests run at a time in each of Firefox, WebKit and the phone,
 * next to Chromium's workers. A test of two parents runs two pages, and these
 * browsers take far more memory and CPU per page than Chromium: with more of
 * them at once, the machine runs out of memory and pages stall past the test
 * timeout.
 */
const HEAVY_BROWSER_WORKERS = 1;

/**
 * The trace of a failed test in WebKit, without the screenshots: WebKit
 * draws them in software, which more than doubles how long a test takes and
 * stalls pages past the test timeout. The actions, DOM snapshots, network
 * and console stay.
 */
const WEBKIT_TRACE = { mode: 'retain-on-failure', screenshots: false } as const;

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: WORKERS,
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: process.env['TEST_IGNORE_HTTPS_ERRORS'] === 'true',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      workers: HEAVY_BROWSER_WORKERS,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], trace: WEBKIT_TRACE },
      workers: HEAVY_BROWSER_WORKERS,
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 17'], trace: WEBKIT_TRACE },
      workers: HEAVY_BROWSER_WORKERS,
    },
  ],
});
