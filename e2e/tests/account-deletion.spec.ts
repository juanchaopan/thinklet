import { expectAccessiblePage } from '../support/accessibility.ts';
import { createFamily, familyWithZihang } from '../support/families.ts';
import { expect, test } from '../support/fixtures.ts';
import { newUser, signIn } from '../support/sign-in.ts';
import { SIDEBAR_SCREEN } from '../support/viewports.ts';

// Deleting a parent's own account (#14, 27; .docs/design/rules.md, 删除账号):
// a member deletes the account from the profile page after confirming, lands
// on the product home under 你的账号已删除, and the old login opens nothing
// any more; the other parents of the family no longer see them. A family's
// admin cannot delete the account until they hand the family over.
test.describe('deleting the account', () => {
  test('a member deletes the account, lands on the product home and cannot come back with the old login', async ({
    page,
    openParentPage,
  }) => {
    await page.setViewportSize(SIDEBAR_SCREEN);
    const { admin, family } = await familyWithZihang(page, openParentPage);
    await page.goto('/profile');
    const oldLogin = await page.context().cookies();

    await page.getByRole('button', { name: '删除账号' }).click();
    const question = page.getByRole('dialog', { name: '删除你的账号？' });
    await expect(question).toContainText(
      '你会离开「林悦的家」。你在好奇星球和 Authing 上的账号都会删掉，不能恢复。',
    );
    await expectAccessiblePage(page);
    await question.getByRole('button', { name: '删除账号' }).click();

    await expect(page).toHaveURL('/?account=deleted');
    const deleted = page.getByRole('dialog', { name: '你的账号已删除' });
    await expect(deleted).toContainText('你在好奇星球上的账号和数据都已删掉。');
    await expectAccessiblePage(page);
    await deleted.getByRole('button', { name: '关闭' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: '家长登录 / 注册' })).toBeVisible();
    const left = await page.context().cookies();
    expect(left.map(({ name }) => name)).not.toContain('thinklet_session');

    await page.context().addCookies(oldLogin);
    await page.goto('/profile');
    await expect(page).toHaveURL('/?returnTo=%2Fprofile');
    await expect(page.getByRole('link', { name: '家长登录 / 注册' })).toBeVisible();

    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByRole('heading', { level: 1, name: '林悦的家' })).toBeVisible();
    await expect(admin.getByText('周子航')).toHaveCount(0);
  });

  test("a family's admin finds 删除账号 faded with the reason", async ({ page }) => {
    await page.setViewportSize(SIDEBAR_SCREEN);
    await signIn(page, newUser('林悦'));
    await createFamily(page, '林悦的家');

    await page.goto('/profile');

    await expect(page.getByRole('button', { name: '删除账号' })).toBeDisabled();
    await expect(
      page.getByText('你还是「林悦的家」的管理员，先把管理员设给别人或者删除家庭，才能删除账号'),
    ).toBeVisible();
    await expectAccessiblePage(page);
  });
});
