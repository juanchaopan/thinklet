import type { Page } from '@playwright/test';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  bringToFront,
  createFamily,
  familyOfLinyue,
  familyWithZihang,
  firstFamily,
  requestCard,
  requestOfZihang,
} from '../support/families.ts';
import { expect, test } from '../support/fixtures.ts';
import { newUser, signIn } from '../support/sign-in.ts';
import { SIDEBAR_SCREEN } from '../support/viewports.ts';

/** The card with the heading on the new members page. */
const card = (page: Page, heading: string) =>
  page.locator('section', { has: page.getByRole('heading', { name: heading }) });

/** Chooses one of 周子航's actions on the family page and confirms it with the button. */
async function actOnZihang(admin: Page, action: string, question: string, confirm: string) {
  await admin.getByRole('button', { name: '周子航的操作' }).click();
  await admin.getByRole('menuitem', { name: action }).click();
  await admin
    .getByRole('dialog', { name: question })
    .getByRole('button', { name: confirm })
    .click();
}

/** Checks that the page says the family is not there and shows none of it. */
async function expectNoFamily(page: Page, name: string, code: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  await expect(page.getByText(code)).toHaveCount(0);
}

// The family page and the new members page, through the mock identity
// provider (.docs/design/rules.md, 家庭, 加入申请, 权限): the admin changes the
// settings, handles requests, changes the code, hands over the admin role and
// takes a member out; a member leaves; a parent of another family sees none
// of it. Each parent has a browser of their own. The browser is in Shanghai.
// A page is checked with axe once its content is shown, so the content's
// entering animations are among those the check finishes first. Steps that
// read the sidebar run on a screen wide enough for it, on the phone too.
test.use({ timezoneId: 'Asia/Shanghai' });

test.describe('family management', () => {
  test('the admin renames the family and moves it to where the browser is, which stays after a reload', async ({
    page,
  }) => {
    await signIn(page, newUser('林悦'));
    const family = await createFamily(page, '林悦的家', 'Asia/Tokyo');

    await page.goto(`/families/${family.id}`);
    await expect(page.getByText('当前位置：Asia/Shanghai（UTC+08:00）')).toBeVisible();
    await page.getByRole('button', { name: '改成这个' }).click();
    await expect(page.getByText('已保存')).toBeVisible();
    await expect(page.getByText(/^当前位置/)).toHaveCount(0);

    await page.getByRole('button', { name: '改家庭名称' }).click();
    await page.getByRole('textbox', { name: '家庭名称' }).fill('林家小院');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '林家小院' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: '林家小院' })).toBeVisible();
    await expect(page.getByText('Asia/Shanghai（UTC+08:00）', { exact: true })).toBeVisible();
    await expect(page.getByText(/^当前位置/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '林家小院 切换家庭' })).toBeVisible();
  });

  test('the admin approves a request on the new members page, and the applicant is in', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await requestOfZihang(page, openParentPage);
    await admin.setViewportSize(SIDEBAR_SCREEN);

    await admin.goto('/');
    await admin.getByRole('link', { name: /^新成员\s*1$/ }).click();
    await expect(admin).toHaveURL(`/families/${family.id}/new-members`);
    await expect(card(admin, '等你处理').getByText('周子航')).toBeVisible();
    await expectAccessiblePage(admin);
    await card(admin, '等你处理').getByRole('button', { name: '同意' }).click();

    await expect(card(admin, '处理过的').locator('li', { hasText: '周子航' })).toContainText(
      '已同意',
    );
    await expect(card(admin, '等你处理').getByText('没有新的申请')).toBeVisible();
    await expect(admin.getByRole('link', { name: /^新成员$/ })).toBeVisible();

    await bringToFront(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByText('你已加入「林悦的家」')).toBeVisible();
    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('heading', { level: 1, name: '林悦的家' })).toBeVisible();
    await expect(page.getByText(/周子航\s*（你）/)).toBeVisible();
  });

  test('the admin rejects a request, and the applicant sees it rejected', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await requestOfZihang(page, openParentPage);

    await admin.goto(`/families/${family.id}/new-members`);
    await card(admin, '等你处理').getByRole('button', { name: '拒绝' }).click();
    await expect(card(admin, '处理过的').locator('li', { hasText: '周子航' })).toContainText(
      '已拒绝',
    );

    await page.reload();
    await expect(requestCard(page, '林悦的家')).toContainText('被拒绝');
    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
  });

  test('the admin changes the code: the old one stops working and the waiting request expires', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await requestOfZihang(page, openParentPage);

    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByText(family.code, { exact: true })).toBeVisible();
    await expectAccessiblePage(admin);
    await admin.getByRole('button', { name: '更换家庭码' }).click();
    await admin
      .getByRole('dialog', { name: '更换家庭码？' })
      .getByRole('button', { name: '更换' })
      .click();

    await expect(admin.getByText('已更换家庭码')).toBeVisible();
    const changed = await firstFamily(admin);
    expect(changed.code).not.toBe(family.code);
    await expect(admin.getByText(changed.code, { exact: true })).toBeVisible();

    await page.reload();
    await expect(requestCard(page, '林悦的家')).toContainText('已失效');
    await expect(requestCard(page, '林悦的家')).toContainText('家庭码已更换');
    await page.getByRole('button', { name: /^申请加入家庭/ }).click();
    await expect(page.getByRole('textbox', { name: '第 1 位' })).toBeFocused();
    await page.keyboard.type(family.code);
    await expect(page.getByText('没有这个家庭码')).toBeVisible();
  });

  test('the admin hands the admin role to a member, who then runs the family', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await familyWithZihang(page, openParentPage);

    await admin.goto(`/families/${family.id}`);
    await actOnZihang(admin, '设为管理员', '让周子航当管理员？', '确定');

    await expect(admin.getByText('「周子航」现在是管理员')).toBeVisible();
    await expect(admin.getByRole('button', { name: '更换家庭码' })).toHaveCount(0);
    await expect(admin.getByRole('button', { name: '改家庭名称' })).toHaveCount(0);
    await expect(admin.getByRole('button', { name: '离开家庭' })).toBeEnabled();

    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('button', { name: '更换家庭码' })).toBeVisible();
    await expect(page.getByRole('button', { name: '林悦的操作' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^新成员/ })).toBeVisible();
  });

  test('the admin takes a member out, who can no longer open the family', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await familyWithZihang(page, openParentPage);

    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByText('家长 · 2')).toBeVisible();
    await actOnZihang(admin, '移出家庭', '把周子航移出家庭？', '移出');

    await expect(admin.getByText('已移出「周子航」')).toBeVisible();
    await expect(admin.getByText('家长 · 1')).toBeVisible();

    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
  });

  test('a member leaves the family, goes to the start page and can no longer open it', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await familyWithZihang(page, openParentPage);

    await page.goto(`/families/${family.id}`);
    await expect(page.getByText('家长 · 2')).toBeVisible();
    await expectAccessiblePage(page);
    await page.getByRole('button', { name: '离开家庭' }).click();
    await page
      .getByRole('dialog', { name: '离开「林悦的家」？' })
      .getByRole('button', { name: '离开' })
      .click();

    await expect(page.getByText('你已离开 林悦的家')).toBeVisible();
    await expect(page).toHaveURL('/start');
    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByText('家长 · 1')).toBeVisible();
  });

  test('a parent of another family who puts its id in the address sees nothing of it', async ({
    page,
    openParentPage,
  }) => {
    const { family } = await familyOfLinyue(openParentPage);
    await signIn(page, newUser('周子航'));
    await createFamily(page, '周家');

    await page.goto(`/families/${family.id}`);
    await expectNoFamily(page, family.name, family.code);
    await expectAccessiblePage(page);
    await page.goto(`/families/${family.id}/new-members`);
    await expectNoFamily(page, family.name, family.code);

    await page.getByRole('button', { name: '周家 切换家庭' }).click();
    await expect(page.getByRole('menu', { name: '切换家庭' }).getByRole('menuitem')).toHaveText([
      /^周家/,
      '创建家庭',
    ]);
  });
});
