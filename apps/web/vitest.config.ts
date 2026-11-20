import { playwright } from '@vitest/browser-playwright';
import { msw } from 'msw/vite';
import { defineConfig } from 'vitest/config';
import { VIEWPORTS } from './src/testing/viewports.ts';

// Component tests: `ng test` (the @angular/build:unit-test builder) compiles
// the specs and runs them with this configuration in Chromium, driven by
// Playwright. Test discovery, setup files and coverage are set in
// angular.json. Screenshot baselines are only valid from the pinned Playwright
// image, so `task test-component` runs this inside it.
//
// The browser is configured here rather than with the builder's `browsers`
// option, because the builder's own Playwright provider cannot take launch
// and context options.
export default defineConfig({
  // Serves /mockServiceWorker.js for the MSW worker in src/testing/network.ts.
  plugins: [msw({ mode: 'worker-only' })],
  resolve: {
    // Packages are resolved at test time; pick their browser builds, as the
    // builder does when it configures the browser itself.
    conditions: ['browser'],
  },
  test: {
    // `task test-component-update` sets UPDATE_SCREENSHOTS to rewrite the
    // baselines; otherwise a missing or different baseline fails the test.
    update: process.env['UPDATE_SCREENSHOTS'] === 'true' ? 'all' : 'none',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        // Fixed rendering: no font hinting or subpixel text, one color
        // profile, so the same image produces the same pixels.
        launchOptions: {
          args: [
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
            '--disable-lcd-text',
            '--force-color-profile=srgb',
          ],
        },
        contextOptions: {
          deviceScaleFactor: 1,
          locale: 'zh-CN',
          timezoneId: 'UTC',
          colorScheme: 'light',
        },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: VIEWPORTS.desktop,
      // Failure screenshots would land next to the baselines; the screenshot
      // matcher already writes the actual image and a diff on failure.
      screenshotFailures: false,
      expect: {
        toMatchScreenshot: {
          // Baselines come from the same image as the comparison, so the
          // pixels must match exactly; even a slight color change fails.
          comparatorName: 'pixelmatch',
          comparatorOptions: {
            threshold: 0,
            allowedMismatchedPixelRatio: 0,
          },
        },
      },
    },
  },
});
