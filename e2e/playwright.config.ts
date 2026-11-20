import { defineConfig, devices } from '@playwright/test';

// End-to-end and smoke tests. They run against BASE_URL, the web origin that
// also forwards /api to the api:
// - `task test-e2e` starts a throwaway environment and sets it;
// - `task test-smoke BASE_URL=...` points it at a deployed environment and
//   runs only the tests tagged @smoke (or @production-safe).
// Chromium runs on every PR; Firefox, WebKit and a touch phone run before a
// release (`task test-e2e-all-browsers`).
const baseURL = process.env['BASE_URL'];
if (!baseURL) {
  throw new Error('Set BASE_URL to the web origin to test (the tasks set it)');
}

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 17'] } },
  ],
});
