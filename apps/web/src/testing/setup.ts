import { page } from 'vitest/browser';
import { useFixedClock } from './clock';
import { startWorker, takeUnhandledApiRequests, worker } from './network';
import { VIEWPORTS } from './viewports';

// Runs before every component test file (angular.json `setupFiles`). Each
// test starts from the same state: a fixed clock, the desktop viewport and
// no api stubs. Test data is written as fixed values in the tests, never
// generated randomly, so screenshots and assertions repeat exactly.

beforeAll(async () => {
  await startWorker();
});

beforeEach(async () => {
  useFixedClock();
  await page.viewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
});

afterEach(() => {
  worker.resetHandlers();
  vi.useRealTimers();
  expect(takeUnhandledApiRequests(), 'api requests without a stub').toEqual([]);
});
