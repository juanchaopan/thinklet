import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * The api's answers to "who is signed in": a page for visitors asks whether
 * a parent (`/api/me`) or a child (`/api/child/me`) is signed in, and for a
 * visitor the answer is 401 by design.
 */
const SIGNED_IN_CHECKS = new Set(['/api/me', '/api/child/me']);

/**
 * Whether a console message is the browser reporting the 401 of a check of
 * who is signed in, which Chromium logs as a failed resource.
 */
function isVisitorCheck(message: ConsoleMessage): boolean {
  const { pathname } = new URL(message.location().url || 'about:blank');
  return SIGNED_IN_CHECKS.has(pathname) && message.text().includes('401');
}

/**
 * Collects what goes wrong on the page from here on: console errors, uncaught
 * exceptions and Content Security Policy violations. A violation is reported
 * through `console.error` by an init script, since the browser raises it as a
 * DOM event that Playwright does not surface on its own.
 */
export async function collectPageProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isVisitorCheck(message)) {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`uncaught exception: ${error.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `CSP violation: ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`,
      );
    });
  });
  return problems;
}

/**
 * Waits until the page has loaded and the events the browser queued by then
 * have run. A violation event is dispatched as a task of its own after the
 * blocked load, so the page is given two animation frames and one more task
 * turn, which come after the tasks already queued, instead of a fixed delay.
 * The console messages those tasks write reach Playwright ahead of the
 * answer to this call, since both come over the same ordered connection.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }),
  );
}
