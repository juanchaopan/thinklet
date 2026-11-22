import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';
import { useFixedClock } from './clock';
import { startWorker, takeUnhandledApiRequests, worker } from './network';
import { emulateReducedMotion, emulateTouch, moveMouseOffPage } from './pointer';
import { VIEWPORTS } from './viewports';

// Runs before every component test file (angular.json `setupFiles`). Each
// test starts from the same state: a fixed clock, the desktop viewport with
// a mouse that rests off the page and full motion, empty local storage and
// no api stubs. Test data is written as fixed values in the tests, never
// generated randomly, so screenshots and assertions repeat exactly.
//
// Test files are not isolated: several run one after another on the same
// browser page, in an order that depends on how many workers share them out.
// Nothing a test leaves behind may reach the next one, so each test ends by
// waiting for the requests it started, then tearing down its app with every
// listener the app holds, and only then checks what reached the api.

/** How long the app may stay busy after a test before the test fails. */
const SETTLE_TIMEOUT = 5000;

beforeAll(async () => {
  await startWorker();
});

beforeEach(async () => {
  useFixedClock();
  localStorage.clear();
  await page.viewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
  await emulateTouch(false);
  await emulateReducedMotion(false);
  await moveMouseOffPage();
});

/**
 * Resolves once the app has nothing left in progress: no api request without
 * its answer, no navigation and no change detection still to run. Angular
 * counts every HttpClient request as pending until it is answered, so a
 * request a test started without waiting for it is answered while the test's
 * stubs are still there, and one without a stub is recorded for this test.
 * A test that rendered nothing gets an empty app, which is settled at once.
 */
async function appSettled(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `The app was still busy ${SETTLE_TIMEOUT} ms after the test: a request without an answer or a navigation that never ended`,
        ),
      );
    }, SETTLE_TIMEOUT);
  });
  try {
    await Promise.race([TestBed.inject(ApplicationRef).whenStable(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Vitest runs the afterEach hooks of a file in reverse order, so this one
// runs before the TestBed teardown that the Angular builder registers, and a
// hook that fails skips the ones after it. The teardown is therefore done
// here, and every check comes after it.
afterEach(async () => {
  // A test may have faked the timers that Angular's change detection and the
  // settle timeout run on.
  vi.useRealTimers();
  let unhandled: string[];
  try {
    await appSettled();
  } finally {
    TestBed.resetTestingModule();
    worker.resetHandlers();
    unhandled = takeUnhandledApiRequests();
  }
  expect(unhandled, 'api requests without a stub').toEqual([]);
});
