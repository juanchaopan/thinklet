import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Collects what goes wrong on the page from here on: console errors, uncaught
 * exceptions and Content Security Policy violations. A violation is reported
 * through `console.error` by an init script, since the browser raises it as a
 * DOM event that Playwright does not surface on its own.
 */
async function collectPageProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
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

test.describe('home page', () => {
  test(
    'opens with the title thinklet in Simplified Chinese, without errors or CSP violations',
    { tag: ['@smoke', '@production-safe'] },
    async ({ page }) => {
      const problems = await collectPageProblems(page);

      const response = await page.goto('/');

      expect(response?.ok()).toBe(true);
      await expect(page).toHaveTitle('thinklet');
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.locator('app-home')).toBeAttached();
      expect(problems).toEqual([]);
    },
  );

  test('has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-home')).toBeAttached();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
