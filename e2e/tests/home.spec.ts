import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Whether a console message is the browser reporting the 401 of
 * `GET /api/me`: the product home asks whether someone is signed in, and for
 * a visitor the answer is 401 by design, which Chromium logs as a failed
 * resource.
 */
function isVisitorCheck(message: ConsoleMessage): boolean {
  const { pathname } = new URL(message.location().url || 'about:blank');
  return pathname === '/api/me' && message.text().includes('401');
}

/**
 * Collects what goes wrong on the page from here on: console errors, uncaught
 * exceptions and Content Security Policy violations. A violation is reported
 * through `console.error` by an init script, since the browser raises it as a
 * DOM event that Playwright does not surface on its own.
 */
async function collectPageProblems(page: Page): Promise<string[]> {
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
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }),
  );
}

test.describe('product home', () => {
  test(
    'opens with the title 好奇星球 in Simplified Chinese and both ways in, without errors or CSP violations',
    { tag: ['@smoke', '@production-safe'] },
    async ({ page }) => {
      const problems = await collectPageProblems(page);

      const response = await page.goto('/');

      expect(response?.ok()).toBe(true);
      await expect(page).toHaveTitle('好奇星球');
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.getByRole('link', { name: '家长登录 / 注册' })).toHaveAttribute(
        'href',
        '/api/auth/login',
      );
      await expect(page.getByRole('link', { name: '孩子登录' })).toHaveAttribute('href', '/child');
      await settle(page);
      expect(problems).toEqual([]);
    },
  );

  test('has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '家长登录 / 注册' })).toBeVisible();
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().endTime !== Infinity) {
          animation.finish();
        }
      }
    });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('sends a visitor from a parent page back to the product home, keeping the page', async ({
    page,
  }) => {
    await page.goto('/profile');

    await expect(page).toHaveURL('/?returnTo=%2Fprofile');
    await expect(page.getByRole('link', { name: '家长登录 / 注册' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fprofile',
    );
  });
});
