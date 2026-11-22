import { expect, test, type Page } from '@playwright/test';
import { expectAccessiblePage } from '../support/accessibility.ts';
import { firstFamily, handleWaitingRequest, pageOfAnotherParent } from '../support/families.ts';
import { createFamily, newUser, signIn } from '../support/sign-in.ts';

/** The characters a family code is made of (rules.md, 家庭). */
const FAMILY_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** The card of the applicant's request to the family with this name. */
const requestCard = (page: Page, familyName: string) =>
  page.locator('[appcard]', { hasText: familyName });

/** Asks to join the family with the code from the start page, typing it into the six boxes. */
async function askToJoin(page: Page, code: string): Promise<void> {
  await page.getByRole('button', { name: /^申请加入家庭/ }).click();
  await expect(page.getByRole('textbox', { name: '第 1 位' })).toBeFocused();
  await page.keyboard.type(code.toLowerCase());
  const confirm = page.getByRole('dialog', { name: '申请加入这个家庭？' });
  await confirm.getByRole('button', { name: '发送申请' }).click();
  await expect(page.getByText('申请已发出')).toBeVisible();
}

// Creating a family and asking to join one, through the mock identity
// provider (.docs/design/rules.md, 家庭, 输入家庭码, 加入申请). The browser is
// in Shanghai, so a new family starts in that time zone. The admin's side of
// a request (approving, rejecting) goes straight through the api.
test.use({ timezoneId: 'Asia/Shanghai' });

test.describe('families', () => {
  test('a parent creates a family in the time zone they choose, and runs it', async ({ page }) => {
    await signIn(page, newUser('林悦'));
    await expect(page).toHaveURL('/start');
    await expectAccessiblePage(page);

    await page.getByRole('button', { name: /^创建家庭/ }).click();
    const dialog = page.getByRole('dialog', { name: '创建家庭' });
    await expect(dialog.getByRole('textbox', { name: '家庭名称' })).toHaveValue('林悦的家');
    const timeZone = dialog.getByRole('button', { name: /^时区/ });
    await expect(timeZone).toHaveText('Asia/Shanghai（UTC+08:00）');
    await expectAccessiblePage(page);
    await timeZone.click();
    await page.getByRole('combobox', { name: '搜索时区' }).fill('tokyo');
    await page.keyboard.press('Enter');
    await expect(timeZone).toHaveText('Asia/Tokyo（UTC+09:00）');
    await dialog.getByRole('button', { name: '创建' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('已创建「林悦的家」')).toBeVisible();
    await expect(page.getByRole('button', { name: '林悦的家 切换家庭' })).toBeVisible();
    const family = await firstFamily(page);
    expect(family).toMatchObject({ name: '林悦的家', timezone: 'Asia/Tokyo', role: 'admin' });
    expect(family.code).toMatch(FAMILY_CODE);
  });

  test('another parent asks to join with an invitation link, waits, and withdraws', async ({
    page,
    browser,
  }, testInfo) => {
    const admin = await pageOfAnotherParent(browser, testInfo);
    await signIn(admin, newUser('林悦'));
    await createFamily(admin, '林悦的家');
    const { code } = await firstFamily(admin);

    await signIn(page, newUser('周子航'), `/join/${code}`);
    await expect(page).toHaveURL(`/join/${code}`);
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
    await expect(admin.getByRole('link', { name: /^新成员\s*1$/ })).toBeVisible();

    await requestCard(page, '林悦的家').getByRole('button', { name: '撤回' }).click();
    await expect(requestCard(page, '林悦的家')).toHaveCount(0);
    await expect(page.getByText('先创建或加入一个家庭。')).toBeVisible();

    await admin.reload();
    await expect(admin.getByRole('link', { name: /^新成员$/ })).toBeVisible();
  });

  test('the applicant sees the request rejected, then approved and the family theirs', async ({
    page,
    browser,
  }, testInfo) => {
    const admin = await pageOfAnotherParent(browser, testInfo);
    await signIn(admin, newUser('林悦'));
    await createFamily(admin, '林悦的家');
    const family = await firstFamily(admin);
    await signIn(page, newUser('周子航'));
    await expect(page).toHaveURL('/start');

    await askToJoin(page, family.code);
    await handleWaitingRequest(admin, family.id, 'reject');
    await page.reload();

    await expect(requestCard(page, '林悦的家')).toContainText('被拒绝');
    await expect(page.getByRole('button', { name: /有新的申请结果$/ })).toBeVisible();
    await requestCard(page, '林悦的家').getByRole('button', { name: '知道了' }).click();
    await expect(requestCard(page, '林悦的家')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^周子航\s*的菜单$/ })).toBeVisible();

    await askToJoin(page, family.code);
    await handleWaitingRequest(admin, family.id, 'approve');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(page).toHaveURL('/');
    await expect(page.getByText('你已加入「林悦的家」')).toBeVisible();
    await expect(page.getByRole('button', { name: '林悦的家 切换家庭' })).toBeVisible();

    const own = page.getByRole('navigation', { name: '周子航' });
    await own.getByRole('link', { name: /^加入家庭\s*，有新的申请结果$/ }).click();
    await expect(page).toHaveURL('/join');
    await expect(requestCard(page, '林悦的家')).toContainText('已同意');
    await expectAccessiblePage(page);
    await requestCard(page, '林悦的家').getByRole('button', { name: '知道了' }).click();

    await expect(page.getByText('还没有发出过申请')).toBeVisible();
    await expect(own.getByRole('link', { name: /^加入家庭$/ })).toBeVisible();
  });
});
