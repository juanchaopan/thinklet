import { expect, test } from '@playwright/test';
import { expectAccessiblePage } from '../support/accessibility.ts';
import { collectPageProblems, settle } from '../support/page-problems.ts';

test.describe('product home', () => {
  test(
    'opens with the title 好奇星球 in Simplified Chinese, what the product is and both ways in, without errors or CSP violations',
    { tag: ['@smoke', '@production-safe'] },
    async ({ page }) => {
      const problems = await collectPageProblems(page);

      const response = await page.goto('/');

      expect(response?.ok()).toBe(true);
      await expect(page).toHaveTitle('好奇星球');
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('把难懂的课，变成好玩的题');
      await expect(
        page.getByText('用有趣的方式带孩子学习难懂、复杂的课程，教他们解题，帮他们整理思路。'),
      ).toBeVisible();
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

    await expectAccessiblePage(page);
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
