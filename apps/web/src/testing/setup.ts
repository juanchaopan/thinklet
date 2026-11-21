import { page } from 'vitest/browser';
import { useFixedClock } from './clock';
import { startWorker, takeUnhandledApiRequests, worker } from './network';
import { emulateReducedMotion, emulateTouch } from './pointer';
import { VIEWPORTS } from './viewports';

// Runs before every component test file (angular.json `setupFiles`). Each
// test starts from the same state: a fixed clock, the desktop viewport with
// a mouse and full motion, empty local storage and no api stubs. Test data
// is written as fixed values in the tests, never generated randomly, so
// screenshots and assertions repeat exactly.

beforeAll(async () => {
  await startWorker();
});

beforeEach(async () => {
  useFixedClock();
  localStorage.clear();
  await page.viewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
  await emulateTouch(false);
  await emulateReducedMotion(false);
});

afterEach(() => {
  worker.resetHandlers();
  vi.useRealTimers();
  expect(takeUnhandledApiRequests(), 'api requests without a stub').toEqual([]);
});
