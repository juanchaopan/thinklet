import type { Page } from '@playwright/test';
import { childListSchema } from '@thinklet/contracts';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  actOnChild,
  addChild,
  childRow,
  childrenApi,
  childrenPage,
  expectError,
  familyWithXiaomi,
  sentFrom,
} from '../support/children.ts';
import { createFamily } from '../support/families.ts';
import { expect, test } from '../support/fixtures.ts';
import { newUser, signIn } from '../support/sign-in.ts';

/** What the guardian agrees to when adding a child (rules.md, 孩子). */
const CONSENT = '我是这个孩子的监护人，同意好奇星球处理孩子的昵称、账号和登录记录';

/** The hint for an account another child of the family has. */
const ACCOUNT_TAKEN = '家里已经有孩子用这个账号了';

/** Fills the nickname and the account of the open add or change dialog. */
async function fillChild(page: Page, nickname: string, account: string): Promise<void> {
  await page.getByRole('textbox', { name: '昵称' }).fill(nickname);
  await page.getByRole('textbox', { name: '账号' }).fill(account);
}

/** Checks that the children page lists these children, each with its account, and no others. */
async function expectChildren(page: Page, children: ReadonlyArray<[string, string]>) {
  for (const [nickname, account] of children) {
    await expect(childRow(page, nickname)).toContainText(`账号 ${account}`);
  }
  await expect(page.getByRole('button', { name: '更多操作' })).toHaveCount(children.length);
}

// The children page, through the mock identity provider (.docs/design/rules.md,
// 孩子, 孩子页, 添加和修改孩子, 权限): a parent adds children, who need a
// nickname, an account no other child of the family has and the guardian's
// consent, and changes them; a parent of another family sees and changes
// none of them, whatever ids the address or the request carries. A page or
// dialog is checked with axe once its content is shown.
test.describe('children', () => {
  test('a parent adds a child, who needs a nickname, an account of their own and the consent', async ({
    page,
  }) => {
    await signIn(page, newUser('林悦'));
    const family = await createFamily(page, '林悦的家');
    await page.goto('/');

    await page
      .getByRole('navigation', { name: '主菜单' })
      .getByRole('link', { name: '孩子' })
      .click();
    await expect(page).toHaveURL(childrenPage(family.id));
    await expect(page.getByRole('heading', { name: '还没有孩子' })).toBeVisible();
    await expectAccessiblePage(page);

    await page.getByRole('button', { name: '添加孩子' }).click();
    const dialog = page.getByRole('dialog', { name: '添加孩子' });
    await expect(dialog.getByRole('checkbox', { name: CONSENT })).not.toBeChecked();
    await expectAccessiblePage(page);
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await expect(dialog.getByText('请填昵称')).toBeVisible();
    await expect(dialog.getByText('请填账号')).toBeVisible();
    await expect(dialog.getByText('请先同意')).toBeVisible();

    await fillChild(page, '小米', 'xiaomi');
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await expect(dialog.getByText('请先同意')).toBeVisible();
    await dialog.getByText(CONSENT).click();
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.getByText('已添加「小米」')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expectChildren(page, [['小米', 'xiaomi']]);
    await expectAccessiblePage(page);

    await page.getByRole('button', { name: '添加孩子' }).click();
    await fillChild(page, '豆豆', 'xiaomi');
    await dialog.getByText(CONSENT).click();
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await expect(dialog.getByText(ACCOUNT_TAKEN)).toBeVisible();
    await page.getByRole('textbox', { name: '账号' }).fill('doudou');
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.getByText('已添加「豆豆」')).toBeVisible();

    await page.reload();
    await expectChildren(page, [
      ['小米', 'xiaomi'],
      ['豆豆', 'doudou'],
    ]);
  });

  test('a parent changes a child’s nickname and account, but not to the account of another child', async ({
    openParentPage,
  }) => {
    const { admin, family } = await familyWithXiaomi(openParentPage);
    await addChild(admin, family.id, '豆豆', 'doudou');

    await admin.goto(childrenPage(family.id));
    await actOnChild(admin, '豆豆', '改昵称和账号');
    const dialog = admin.getByRole('dialog', { name: '修改豆豆' });
    await expect(dialog.getByRole('textbox', { name: '昵称' })).toHaveValue('豆豆');
    await expect(dialog.getByRole('textbox', { name: '账号' })).toHaveValue('doudou');
    await expectAccessiblePage(admin);

    await dialog.getByRole('textbox', { name: '账号' }).fill('xiaomi');
    await dialog.getByRole('button', { name: '保存' }).click();
    await expect(dialog.getByText(ACCOUNT_TAKEN)).toBeVisible();

    await fillChild(admin, '朵儿', 'duoer');
    await dialog.getByRole('button', { name: '保存' }).click();
    await expect(admin.getByText('已保存')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expectChildren(admin, [
      ['小米', 'xiaomi'],
      ['朵儿', 'duoer'],
    ]);
    await expect(childRow(admin, '豆豆')).toHaveCount(0);
  });

  test('a parent of another family who puts its ids in the address or the request sees and changes none of its children', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family, child } = await familyWithXiaomi(openParentPage);
    await signIn(page, newUser('周子航'));
    const own = await createFamily(page, '周家');
    const origin = sentFrom(page);

    await page.goto(childrenPage(family.id));
    await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
    await expect(page.getByText('小米')).toHaveCount(0);
    await expectAccessiblePage(page);

    const theirs = childrenApi(family.id, child.id);
    await expectError(page.request.get(childrenApi(family.id)), 404, 'family_not_found');
    await expectError(
      page.request.patch(theirs, { data: { nickname: '小黑' }, headers: origin }),
      404,
      'family_not_found',
    );
    await expectError(page.request.delete(theirs, { headers: origin }), 404, 'family_not_found');

    const underOwn = childrenApi(own.id, child.id);
    await expectError(
      page.request.patch(underOwn, { data: { nickname: '小黑' }, headers: origin }),
      404,
      'child_not_found',
    );
    await expectError(
      page.request.post(`${underOwn}/password-reset`, { headers: origin }),
      404,
      'child_not_found',
    );
    await expectError(
      page.request.post(`${underOwn}/login-links`, { headers: origin }),
      404,
      'child_not_found',
    );
    await expectError(page.request.get(`${underOwn}/devices`), 404, 'child_not_found');
    await expectError(page.request.delete(underOwn, { headers: origin }), 404, 'child_not_found');

    await page.goto(childrenPage(own.id));
    await expect(page.getByRole('heading', { name: '还没有孩子' })).toBeVisible();
    const listed = await admin.request.get(childrenApi(family.id));
    expect(childListSchema.parse(await listed.json())).toEqual([child]);
  });
});
