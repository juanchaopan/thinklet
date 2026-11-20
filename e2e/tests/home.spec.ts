import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('home page', () => {
  test(
    'opens with the title thinklet in Simplified Chinese',
    { tag: ['@smoke', '@production-safe'] },
    async ({ page }) => {
      const response = await page.goto('/');

      expect(response?.ok()).toBe(true);
      await expect(page).toHaveTitle('thinklet');
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.locator('app-home')).toBeAttached();
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
