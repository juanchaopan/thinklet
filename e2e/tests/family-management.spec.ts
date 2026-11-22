import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  askToJoin,
  bringToFront,
  firstFamily,
  handleWaitingRequest,
  pageOfAnotherParent,
  requestCard,
  type FamilySummary,
} from '../support/families.ts';
import { createFamily, newUser, signIn } from '../support/sign-in.ts';

/** 林悦's family, with 林悦 signed in as its admin in a browser of her own. */
async function familyOfLinyue(
  browser: Browser,
  testInfo: TestInfo,
): Promise<{ admin: Page; family: FamilySummary }> {
  const admin = await pageOfAnotherParent(browser, testInfo);
  await signIn(admin, newUser('林悦'));
  await createFamily(admin, '林悦的家');
  return { admin, family: await firstFamily(admin) };
}

/** 林悦's family, which 周子航, signed in on `page`, has asked to join. */
async function requestOfZihang(page: Page, browser: Browser, testInfo: TestInfo) {
  const linyue = await familyOfLinyue(browser, testInfo);
  await signIn(page, newUser('周子航'));
  await askToJoin(page, linyue.family.code);
  return linyue;
}

/** 林悦's family with 周子航, signed in on `page`, as one of its members. */
async function familyWithZihang(page: Page, browser: Browser, testInfo: TestInfo) {
  const linyue = await requestOfZihang(page, browser, testInfo);
  await handleWaitingRequest(linyue.admin, linyue.family.id, 'approve');
  return linyue;
}

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

// The family page and the new members page, through the mock identity
// provider (.docs/design/rules.md, 家庭, 加入申请, 权限): the admin handles
// requests, changes the code, hands over the admin role and takes a member
// out; a member leaves. Each parent has a browser of their own.
test.use({ timezoneId: 'Asia/Shanghai' });

test.describe('family management', () => {
  test('the admin approves a request on the new members page, and the applicant is in', async ({
    page,
    browser,
  }, testInfo) => {
    const { admin, family } = await requestOfZihang(page, browser, testInfo);

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
    browser,
  }, testInfo) => {
    const { admin, family } = await requestOfZihang(page, browser, testInfo);

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
    browser,
  }, testInfo) => {
    const { admin, family } = await requestOfZihang(page, browser, testInfo);

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
    browser,
  }, testInfo) => {
    const { admin, family } = await familyWithZihang(page, browser, testInfo);

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
    browser,
  }, testInfo) => {
    const { admin, family } = await familyWithZihang(page, browser, testInfo);

    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByText('家长 · 2')).toBeVisible();
    await actOnZihang(admin, '移出家庭', '把周子航移出家庭？', '移出');

    await expect(admin.getByText('已移出「周子航」')).toBeVisible();
    await expect(admin.getByText('家长 · 1')).toBeVisible();

    await page.goto(`/families/${family.id}`);
    await expect(page.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeVisible();
  });

  test('a member leaves the family and, with no family left, goes to the start page', async ({
    page,
    browser,
  }, testInfo) => {
    const { admin, family } = await familyWithZihang(page, browser, testInfo);

    await page.goto(`/families/${family.id}`);
    await expectAccessiblePage(page);
    await page.getByRole('button', { name: '离开家庭' }).click();
    await page
      .getByRole('dialog', { name: '离开「林悦的家」？' })
      .getByRole('button', { name: '离开' })
      .click();

    await expect(page.getByText('你已离开 林悦的家')).toBeVisible();
    await expect(page).toHaveURL('/start');
    await admin.goto(`/families/${family.id}`);
    await expect(admin.getByText('家长 · 1')).toBeVisible();
  });
});
