import { expectAccessiblePage } from '../support/accessibility.ts';
import { addChild } from '../support/children.ts';
import { createFamily, familySwitcher, familyWithZihang } from '../support/families.ts';
import { expect, test } from '../support/fixtures.ts';
import { newUser, signIn } from '../support/sign-in.ts';

// Deleting a family (#14, 27; .docs/design/rules.md, 删除家庭 and 当前家庭):
// the admin deletes it from the family page after confirming, also while
// it has other parents, and goes on to the library of their next family,
// or to the start page when none is left. The other parents keep their
// accounts and find the family gone.
test.describe('deleting a family', () => {
  test('the admin deletes a family with a child and another parent, and lands in the next family’s library', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await familyWithZihang(page, openParentPage);
    await addChild(admin, family.id, '小米', 'xiaomi');
    await createFamily(admin, '外婆家');

    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByText('家长 · 2')).toBeVisible();
    await admin.getByRole('button', { name: '删除家庭' }).click();
    const question = admin.getByRole('dialog', { name: '删除「林悦的家」？' });
    await expect(question).toContainText(
      '1 个孩子和他们的书、学习记录都会删掉，另外 1 位家长会离开这个家庭。不能恢复。',
    );
    await expectAccessiblePage(admin);
    await question.getByRole('button', { name: '删除家庭' }).click();

    await expect(admin.getByText('已删除「林悦的家」')).toBeVisible();
    await expect(admin).toHaveURL('/');
    await expect(familySwitcher(admin, '外婆家')).toBeVisible();

    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
    expect((await page.request.get('/api/me')).status()).toBe(200);
  });

  test('the admin of a single family deletes it and lands on the start page', async ({ page }) => {
    await signIn(page, newUser('林悦'));
    const family = await createFamily(page, '林悦的家');

    await page.goto(`/families/${family.id}`);
    await page.getByRole('button', { name: '删除家庭' }).click();
    const question = page.getByRole('dialog', { name: '删除「林悦的家」？' });
    await expect(question).toContainText('不能恢复。');
    await question.getByRole('button', { name: '删除家庭' }).click();

    await expect(page.getByText('已删除「林悦的家」')).toBeVisible();
    await expect(page).toHaveURL('/start');
    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
  });
});
