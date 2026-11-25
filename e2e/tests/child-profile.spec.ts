import { childListSchema } from '@thinklet/contracts';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  PASSWORD,
  childRow,
  childSettingsLink,
  childrenApi,
  childrenPage,
  expectChildHome,
  familyWithXiaomiWithPassword,
  loginWithAccount,
} from '../support/children.ts';
import { expect, test } from '../support/fixtures.ts';

// The child's own settings through the real api (.docs/design/rules.md,
// 孩子的个人设置; #14, 26): a signed-in child opens them from the avatar in
// the top bar, sees the account and the family's name, changes the
// nickname, which the parents see at once, and signs out there, back to the
// child login. `page` is the child's device; the parent has a page of her own.
test.describe("the child's own settings", () => {
  test('a child opens the settings from the avatar, changes the nickname the parent then sees, and signs out', async ({
    page,
    openParentPage,
    request,
  }) => {
    const { admin, family, child } = await familyWithXiaomiWithPassword(openParentPage, request);
    await page.goto('/child');
    await loginWithAccount(page, { code: family.code, account: 'xiaomi', password: PASSWORD });
    await expect(page).toHaveURL('/child/home');
    await expectChildHome(page, '小米');
    await expect(page.getByRole('button', { name: /退出/ })).toHaveCount(0);

    await childSettingsLink(page, '小米').click();
    await expect(page).toHaveURL('/child/profile');
    await expect(page.getByRole('heading', { level: 1, name: '个人设置' })).toBeVisible();
    await expect(page.getByText('xiaomi', { exact: true })).toBeVisible();
    await expect(page.getByText('林悦的家', { exact: true })).toBeVisible();
    await expect(childSettingsLink(page, '小米')).toHaveAttribute('aria-current', 'page');
    await expectAccessiblePage(page);

    await page.getByRole('button', { name: '改昵称' }).click();
    const nickname = page.getByRole('textbox', { name: '昵称' });
    await nickname.fill('');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('请填昵称')).toBeVisible();
    await nickname.fill('米米');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('已保存')).toBeVisible();
    await expect(childSettingsLink(page, '米米')).toBeVisible();

    await admin.goto(childrenPage(family.id));
    await expect(childRow(admin, '米米')).toBeVisible();
    const list = await admin.request.get(childrenApi(family.id));
    expect(childListSchema.parse(await list.json())).toEqual([{ ...child, nickname: '米米' }]);

    await page.getByRole('link', { name: '返回' }).click();
    await expect(page).toHaveURL('/child/home');
    await expectChildHome(page, '米米');

    await childSettingsLink(page, '米米').click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL('/child');
    await expect(page.getByRole('heading', { level: 1, name: '孩子登录' })).toBeVisible();
    await page.goto('/child/profile');
    await expect(page).toHaveURL('/child');
  });
});
