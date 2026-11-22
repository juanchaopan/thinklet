import type { Page } from '@playwright/test';
import { expectAccessiblePage } from '../support/accessibility.ts';
import { createFamily, familyWithZihang } from '../support/families.ts';
import { expect, test } from '../support/fixtures.ts';
import { newUser, signIn } from '../support/sign-in.ts';
import { PHONE_SCREEN, SIDEBAR_SCREEN } from '../support/viewports.ts';

/** 林悦's avatar button, which screen readers hear as "林悦的菜单". */
const AVATAR = /^林悦\s*的菜单/;

/** Opens 林悦's menu from the avatar and goes to 个人设置. */
async function openProfileFromAvatar(page: Page): Promise<void> {
  await page.getByRole('button', { name: AVATAR }).click();
  await page.getByRole('menuitem', { name: '个人设置' }).click();
  await expect(page).toHaveURL('/profile');
}

// The signed-in parent's way around and their own settings
// (.docs/design/rules.md, 登录和登录状态, 导航, 个人设置): the child login is
// open to everyone, a parent without a family starts on the start page and
// reaches the profile, which leads back there, a parent with a family goes
// from the start page to the home page and finds their own pages in the
// sidebar or behind the avatar, and a new name reaches the other parents of
// the family, where the sidebar shows it.
test.describe('signed-in parent', () => {
  test('sees the child login as it is', async ({ page }) => {
    await signIn(page, newUser('林悦'), '/child');

    await expect(page).toHaveURL('/child');
    await expect(page.getByRole('heading', { level: 1, name: '孩子登录' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('without a family starts on the start page and comes back to it from the profile', async ({
    page,
  }) => {
    await signIn(page, newUser('林悦'));

    await expect(page).toHaveURL('/start');
    await openProfileFromAvatar(page);

    await expect(page.getByRole('heading', { level: 1, name: '个人设置' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.getByRole('link', { name: '返回' }).click();
    await expect(page).toHaveURL('/start');
  });

  test('with a family goes from the start page to the home page and finds their own pages', async ({
    page,
  }) => {
    await page.setViewportSize(SIDEBAR_SCREEN);
    await signIn(page, newUser('林悦'));
    await createFamily(page, '林悦的家');

    await page.goto('/start');

    await expect(page).toHaveURL('/');
    await expect(page.getByText('欢迎回来，林悦')).toBeVisible();
    const own = page.getByRole('navigation', { name: '林悦' });
    await expect(own.getByRole('link')).toHaveText(['加入家庭', '个人设置']);
    await expect(page.getByRole('button', { name: AVATAR })).toHaveCount(0);

    await page.setViewportSize(PHONE_SCREEN);
    await openProfileFromAvatar(page);

    await expect(page.getByRole('link', { name: '返回' })).toHaveCount(0);
  });

  test('renames themself on the profile, and the other parent of the family sees the new name', async ({
    page,
    openParentPage,
  }) => {
    await page.setViewportSize(SIDEBAR_SCREEN);
    const { admin, family } = await familyWithZihang(page, openParentPage);

    await page.goto('/profile');
    const rename = page.getByRole('button', { name: '改名字' });
    await expect(rename).toBeVisible();
    await expectAccessiblePage(page);
    await rename.click();
    await page.getByRole('textbox', { name: '名字' }).fill('  周小航 ');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('已保存')).toBeVisible();
    await page.reload();
    await expect(page.getByText('周小航', { exact: true }).first()).toBeVisible();

    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByRole('button', { name: '周小航的操作' })).toBeVisible();
    await expect(admin.getByText('周子航')).toHaveCount(0);
  });
});
