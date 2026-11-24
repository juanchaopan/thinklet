import type { Page } from '@playwright/test';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  askToJoin,
  bringToFront,
  createFamily,
  familyManagementLink,
  familyOfLinyue,
  familySwitcher,
  firstFamily,
  handleWaitingRequest,
  pickTimeZone,
  requestCard,
  switchFamily,
  type FamilySummary,
} from '../support/families.ts';
import { expect, test, type OpenParentPage } from '../support/fixtures.ts';
import { newUser, signIn } from '../support/sign-in.ts';
import { SIDEBAR_SCREEN } from '../support/viewports.ts';

/** The characters a family code is made of (rules.md, 家庭). */
const FAMILY_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** 周子航 on the start page, with a request to 林悦's family that 林悦 has just handled. */
async function handledRequestOfZihang(
  page: Page,
  openParentPage: OpenParentPage,
  decision: 'approve' | 'reject',
) {
  const linyue = await familyOfLinyue(openParentPage);
  await signIn(page, newUser('周子航'));
  await expect(page).toHaveURL('/start');
  await askToJoin(page, linyue.family.code);
  await handleWaitingRequest(linyue.admin, linyue.family.id, decision);
  return linyue;
}

/** The family whose page is open, read through the api. */
async function familyOnPage(page: Page): Promise<FamilySummary> {
  await expect(page).toHaveURL(/\/families\/[^/]+$/);
  const familyId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  const response = await page.request.get(`/api/families/${familyId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as FamilySummary;
}

/** Checks that the family page shows this family's own name, code and time zone. */
async function expectFamilyPage(page: Page, family: FamilySummary, timeZone: string) {
  await expect(page.getByRole('heading', { level: 1, name: family.name })).toBeVisible();
  await expect(page.getByText(family.code, { exact: true })).toBeVisible();
  await expect(page.getByText(timeZone, { exact: true })).toBeVisible();
}

// Creating a family, asking to join one and moving between families, through
// the mock identity provider (.docs/design/rules.md, 家庭, 输入家庭码, 加入申请,
// 当前家庭, 通知). The browser is in Shanghai, so a new family starts in that
// time zone. The admin's side of a request (approving, rejecting) goes
// straight through the api. A page is checked with axe once its content is
// shown. Steps that read the sidebar run on a screen wide enough for it, on
// the phone too.
test.use({ timezoneId: 'Asia/Shanghai' });

test.describe('families', () => {
  test('a parent creates a family in the time zone they choose, and runs it', async ({ page }) => {
    await signIn(page, newUser('林悦'));
    await expect(page).toHaveURL('/start');
    const create = page.getByRole('button', { name: /^创建家庭/ });
    await expect(create).toBeVisible();
    await expectAccessiblePage(page);

    await create.click();
    const dialog = page.getByRole('dialog', { name: '创建家庭' });
    await expect(dialog.getByRole('textbox', { name: '家庭名称' })).toHaveValue('林悦的家');
    await expect(dialog.getByRole('button', { name: /^时区/ })).toHaveText(
      'Asia/Shanghai（UTC+08:00）',
    );
    await expectAccessiblePage(page);
    await pickTimeZone(page, dialog, 'tokyo', 'Asia/Tokyo（UTC+09:00）');
    await dialog.getByRole('button', { name: '创建' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('已创建「林悦的家」')).toBeVisible();
    await expect(familySwitcher(page, '林悦的家')).toBeVisible();
    const family = await firstFamily(page);
    expect(family).toMatchObject({ name: '林悦的家', timezone: 'Asia/Tokyo', role: 'admin' });
    expect(family.code).toMatch(FAMILY_CODE);
  });

  test('another parent asks to join with an invitation link, waits, and withdraws', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await familyOfLinyue(openParentPage);
    await admin.setViewportSize(SIDEBAR_SCREEN);

    await signIn(page, newUser('周子航'), `/join/${family.code}`);
    await expect(page).toHaveURL(`/join/${family.code}`);
    const confirm = page.getByRole('dialog', { name: '申请加入这个家庭？' });
    await expect(confirm.getByText('林悦的家')).toBeVisible();
    await expect(confirm.getByText('管理员 林悦')).toBeVisible();
    await confirm.getByRole('button', { name: '发送申请' }).click();

    await expect(page.getByText('申请已发出')).toBeVisible();
    await expect(page).toHaveURL('/start');
    await expect(requestCard(page, '林悦的家')).toContainText('等待中');
    await expect(requestCard(page, '林悦的家')).toContainText('管理员 林悦');
    await expectAccessiblePage(page);

    await admin.goto('/');
    await expect(familySwitcher(admin, '林悦的家', 1)).toBeVisible();
    await expect(familyManagementLink(admin, 1)).toBeVisible();

    await requestCard(page, '林悦的家').getByRole('button', { name: '撤回' }).click();
    await expect(requestCard(page, '林悦的家')).toHaveCount(0);
    await expect(page.getByText('先创建或加入一个家庭。')).toBeVisible();

    await admin.reload();
    await expect(familySwitcher(admin, '林悦的家')).toBeVisible();
    await expect(familyManagementLink(admin)).toBeVisible();
  });

  test('the applicant sees the request rejected, clears it and may ask again', async ({
    page,
    openParentPage,
  }) => {
    const { family } = await handledRequestOfZihang(page, openParentPage, 'reject');
    await page.reload();

    await expect(requestCard(page, '林悦的家')).toContainText('被拒绝');
    await expect(page.getByRole('button', { name: /有新的申请结果$/ })).toBeVisible();
    await requestCard(page, '林悦的家').getByRole('button', { name: '知道了' }).click();
    await expect(requestCard(page, '林悦的家')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^周子航\s*的菜单$/ })).toBeVisible();

    await askToJoin(page, family.code);
    await expect(requestCard(page, '林悦的家')).toContainText('等待中');
  });

  test('the applicant let in goes to the family, then clears the approval on the join page', async ({
    page,
    openParentPage,
  }) => {
    await page.setViewportSize(SIDEBAR_SCREEN);
    await handledRequestOfZihang(page, openParentPage, 'approve');
    await bringToFront(page);

    await expect(page).toHaveURL('/');
    await expect(page.getByText('你已加入「林悦的家」')).toBeVisible();
    await expect(familySwitcher(page, '林悦的家')).toBeVisible();

    const own = page.getByRole('navigation', { name: '周子航' });
    await own.getByRole('link', { name: /^加入家庭\s*，有新的申请结果$/ }).click();
    await expect(page).toHaveURL('/join');
    await expect(requestCard(page, '林悦的家')).toContainText('已同意');
    await expectAccessiblePage(page);
    await requestCard(page, '林悦的家').getByRole('button', { name: '知道了' }).click();

    await expect(page.getByText('还没有发出过申请')).toBeVisible();
    await expect(own.getByRole('link', { name: /^加入家庭$/ })).toBeVisible();
  });

  test('a parent of two families switches between them, each with its own name, time zone and code', async ({
    page,
  }) => {
    await signIn(page, newUser('林悦'));
    const first = await createFamily(page, '林悦的家');
    await page.goto('/');

    await familySwitcher(page, '林悦的家').click();
    await page.getByRole('menuitem', { name: '创建家庭' }).click();
    const dialog = page.getByRole('dialog', { name: '创建家庭' });
    await dialog.getByRole('textbox', { name: '家庭名称' }).fill('外婆家');
    await pickTimeZone(page, dialog, 'tokyo', 'Asia/Tokyo（UTC+09:00）');
    await dialog.getByRole('button', { name: '创建' }).click();
    await expect(page.getByText('已创建「外婆家」')).toBeVisible();

    await familySwitcher(page, '外婆家').click();
    await expect(page.getByRole('menu', { name: '切换家庭' }).getByRole('menuitem')).toHaveText([
      /^林悦的家/,
      /^外婆家/,
      '创建家庭',
    ]);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: '家庭管理' }).click();
    await expectFamilyPage(page, await familyOnPage(page), 'Asia/Tokyo（UTC+09:00）');
    await expectAccessiblePage(page);

    await switchFamily(page, '外婆家', '林悦的家');
    await expect(page).toHaveURL(`/families/${first.id}`);
    await expectFamilyPage(page, first, 'Asia/Shanghai（UTC+08:00）');

    await page.goto('/');
    await expect(familySwitcher(page, '林悦的家')).toBeVisible();
  });
});
