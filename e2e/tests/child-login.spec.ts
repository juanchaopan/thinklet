import type { APIRequestContext, Page } from '@playwright/test';
import { childListSchema, rememberedChildListSchema } from '@thinklet/contracts';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  PASSWORD,
  actOnChild,
  childRow,
  childrenApi,
  childrenPage,
  expectChildHome,
  expectError,
  familyWithXiaomi,
  familyWithXiaomiOn,
  familyWithXiaomiWithPassword,
  loginWithAccount,
  logoutChild,
  sentFrom,
  showLoginQr,
  type ChildCredentials,
  type FamilyWithChild,
} from '../support/children.ts';
import { bringToFront } from '../support/families.ts';
import { expect, test, type OpenParentPage } from '../support/fixtures.ts';
import { collectPageProblems, settle } from '../support/page-problems.ts';
import { newUser, signIn } from '../support/sign-in.ts';

/** What the child login says when any of the three is wrong, without saying which. */
const REFUSED = '家庭码、账号或密码不对';

/** What a login link says once it is no longer valid. */
const LINK_INVALID = '这个二维码已经失效了';

/** What the QR login says to a child who has no password yet. */
const SET_PASSWORD = '先设一个密码，以后登录要用。';

/** 小米's right family code, account and password. */
function xiaomiCredentials({ family }: FamilyWithChild): ChildCredentials {
  return { code: family.code, account: 'xiaomi', password: PASSWORD };
}

/** Another family code of the same characters, which is not the family's own. */
function anotherCode(code: string): string {
  return `${code.startsWith('2') ? '3' : '2'}${code.slice(1)}`;
}

/** Signs 小米 in with his account on the child login of `page`, remembering the device when asked. */
async function xiaomiSignsIn(page: Page, linyue: FamilyWithChild, remember = false) {
  await page.goto('/child');
  await loginWithAccount(page, xiaomiCredentials(linyue), remember);
  await expect(page).toHaveURL('/child/home');
  await expectChildHome(page, '小米');
}

/** The avatar to tap on a child login that remembers the child with this nickname. */
function avatar(page: Page, nickname: string) {
  return page.getByRole('button', { name: new RegExp(nickname) });
}

/**
 * 林悦's family with 小米, who has signed in on `page` remembering the
 * device and signed out again, so the child login there shows his avatar.
 */
async function xiaomiRememberedOn(
  page: Page,
  openParentPage: OpenParentPage,
  request: APIRequestContext,
): Promise<FamilyWithChild> {
  const linyue = await familyWithXiaomiWithPassword(openParentPage, request);
  await xiaomiSignsIn(page, linyue, true);
  await logoutChild(page);
  await expect(avatar(page, '小米')).toBeVisible();
  return linyue;
}

/** The password box of the page's form. */
function passwordBox(page: Page) {
  return page.getByLabel('密码', { exact: true });
}

/** Checks that the child login is the form filled in for 小米, saying the device has to type the password again. */
async function expectRelogin(page: Page): Promise<void> {
  await expect(page.getByText('这台设备需要重新输入密码')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '账号' })).toHaveValue('xiaomi');
  await expect(passwordBox(page)).toBeFocused();
}

/** Types the password into the form shown and signs in. */
async function typePassword(page: Page, password: string): Promise<void> {
  await passwordBox(page).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

// The child's side of the login and what the parents do to it, through the
// real api (.docs/design/rules.md, 孩子, 登录二维码, 孩子登录, 记住的设备,
// 登录和登录状态, 权限). Each parent and each child device has a browser of
// its own; `page` is the child's device. The children's first passwords and
// the families are made straight through the api where a test is not about
// them. The address a QR code holds is read from the api's answer when the
// dialog makes the link, not from the picture. A link that has run out after
// 10 minutes is left to the api's integration tests, which set the api's
// clock; these tests run against the api as it is. A page is checked with axe
// once its content is shown.
test.describe('the child login', () => {
  test('a child scans the QR code, sets a password and is in; the parent sees it, and the code works once', async ({
    page,
    openParentPage,
  }) => {
    const { admin, family } = await familyWithXiaomi(openParentPage);
    await admin.goto(childrenPage(family.id));
    await expect(childRow(admin, '小米')).toBeVisible();
    const link = await showLoginQr(admin, '小米');
    await expectAccessiblePage(admin);

    await page.goto(link);
    await expect(page.getByRole('heading', { name: '你好，小米！' })).toBeVisible();
    await expect(page.getByText(SET_PASSWORD)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '在这台设备上记住我' })).toBeChecked();
    await expectAccessiblePage(page);
    await passwordBox(page).fill(PASSWORD);
    await page.getByLabel('再输一遍', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '设好了，进入' }).click();

    await expect(page).toHaveURL('/child/home');
    await expectChildHome(page, '小米');
    await expectAccessiblePage(page);
    const dialog = admin.getByRole('dialog', { name: '让小米扫码登录' });
    await expect(dialog.getByText('小米已登录')).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: '完成' }).click();
    await expect(dialog).toHaveCount(0);

    await page.goto(link);
    await expect(page.getByRole('heading', { name: LINK_INVALID })).toBeVisible();
    await expectAccessiblePage(page);
  });

  test('a child with a password who scans a new code types the password, and a wrong one is said', async ({
    page,
    openParentPage,
    request,
  }) => {
    const { admin, family } = await familyWithXiaomiWithPassword(openParentPage, request);
    await admin.goto(childrenPage(family.id));
    const link = await showLoginQr(admin, '小米');

    await page.goto(link);
    await expect(page.getByText('输入你的密码。')).toBeVisible();
    await expectAccessiblePage(page);
    await typePassword(page, 'not-his-password');
    await expect(page.getByText('密码不对')).toBeVisible();
    await expect(passwordBox(page)).toHaveValue('');

    await typePassword(page, PASSWORD);
    await expect(page).toHaveURL('/child/home');
    await expectChildHome(page, '小米');
  });

  test('a child signs in with the family code, account and password, and any wrong one is refused without saying which', async ({
    page,
    openParentPage,
    request,
  }) => {
    const linyue = await familyWithXiaomiWithPassword(openParentPage, request);
    const right = xiaomiCredentials(linyue);

    await page.goto('/child');
    await expect(page.getByRole('heading', { level: 1, name: '孩子登录' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '在这台设备上记住我' })).not.toBeChecked();
    await expectAccessiblePage(page);

    for (const wrong of [
      { ...right, code: anotherCode(right.code) },
      { ...right, account: 'xiaohong' },
      { ...right, password: 'not-his-password' },
    ]) {
      await loginWithAccount(page, wrong);
      await expect(page.getByRole('alert')).toHaveText(REFUSED);
      await expect(passwordBox(page)).toHaveValue('');
      await expect(page).toHaveURL('/child');
    }

    await loginWithAccount(page, right);
    await expect(page).toHaveURL('/child/home');
    await expectChildHome(page, '小米');
  });

  test('a child not remembered leaves no avatar on signing out; one remembered taps the avatar and is in without a password', async ({
    page,
    openParentPage,
    request,
  }) => {
    const linyue = await familyWithXiaomiWithPassword(openParentPage, request);

    await xiaomiSignsIn(page, linyue);
    await logoutChild(page);
    await expect(page.getByRole('heading', { level: 1, name: '孩子登录' })).toBeVisible();
    await expect(avatar(page, '小米')).toHaveCount(0);

    await loginWithAccount(page, xiaomiCredentials(linyue), true);
    await expect(page).toHaveURL('/child/home');
    await logoutChild(page);
    await expect(page.getByRole('heading', { name: '点你的头像登录' })).toBeVisible();
    await expectAccessiblePage(page);
    await avatar(page, '小米').click();

    await expect(page).toHaveURL('/child/home');
    await expectChildHome(page, '小米');
  });

  test('once the parent revokes the remembered device, tapping the avatar there asks for the password', async ({
    page,
    openParentPage,
    request,
  }) => {
    const { admin, family } = await xiaomiRememberedOn(page, openParentPage, request);

    await admin.goto(childrenPage(family.id));
    await actOnChild(admin, '小米', '记住的设备');
    const devices = admin.getByRole('dialog', { name: '小米记住的设备' });
    await expect(devices.getByRole('listitem')).toHaveCount(1);
    await expectAccessiblePage(admin);
    await devices.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(devices.getByText('还没有记住的设备')).toBeVisible();

    await avatar(page, '小米').click();
    await expectRelogin(page);
    await expectAccessiblePage(page);
    await typePassword(page, PASSWORD);
    await expect(page).toHaveURL('/child/home');
  });

  test('after the parent resets the password the old one no longer works, the signed-in child is sent out, and the next code asks for a new one', async ({
    page,
    openParentPage,
    request,
  }) => {
    const linyue = await familyWithXiaomiWithPassword(openParentPage, request);
    const { admin, family } = linyue;
    await xiaomiSignsIn(page, linyue);

    await admin.goto(childrenPage(family.id));
    await actOnChild(admin, '小米', '重设密码');
    const confirm = admin.getByRole('dialog', { name: '重设小米的密码？' });
    await expectAccessiblePage(admin);
    await confirm.getByRole('button', { name: '重设' }).click();
    await expect(admin.getByText('已重设「小米」的密码')).toBeVisible();

    await bringToFront(page);
    await expect(page).toHaveURL('/child');
    await loginWithAccount(page, xiaomiCredentials(linyue));
    await expect(page.getByRole('alert')).toHaveText(REFUSED);

    const link = await showLoginQr(admin, '小米');
    await page.goto(link);
    await expect(page.getByText(SET_PASSWORD)).toBeVisible();
  });

  test('deleting a child takes all of the child away, and the remembered device can no longer sign in', async ({
    page,
    openParentPage,
    request,
  }) => {
    const { admin, family, child } = await xiaomiRememberedOn(page, openParentPage, request);

    await admin.goto(childrenPage(family.id));
    await actOnChild(admin, '小米', '删除');
    await expectAccessiblePage(admin);
    await admin
      .getByRole('dialog', { name: '删除小米？' })
      .getByRole('button', { name: '删除' })
      .click();
    await expect(admin.getByText('已删除「小米」')).toBeVisible();
    await expect(admin.getByRole('heading', { name: '还没有孩子' })).toBeVisible();
    const list = await admin.request.get(childrenApi(family.id));
    expect(childListSchema.parse(await list.json())).toEqual([]);
    await expectError(
      admin.request.get(`${childrenApi(family.id, child.id)}/devices`),
      404,
      'child_not_found',
    );

    await avatar(page, '小米').click();
    await expectRelogin(page);
    await typePassword(page, PASSWORD);
    await expect(page.getByRole('alert')).toHaveText(REFUSED);
    const remembered = await page.request.get('/api/child-auth/remembered');
    expect(rememberedChildListSchema.parse(await remembered.json())).toEqual([]);
  });

  test('a parent and a child signed in on the same browser each have their own home', async ({
    page,
    request,
  }) => {
    await signIn(page, newUser('林悦'));
    const linyue = await familyWithXiaomiOn(page, request);

    await page.goto('/child');
    await expect(page.getByRole('heading', { level: 1, name: '孩子登录' })).toBeVisible();
    await loginWithAccount(page, xiaomiCredentials(linyue));
    await expect(page).toHaveURL('/child/home');
    await expectChildHome(page, '小米');
    await page.goto('/');
    await expect(page.getByText('欢迎回来，林悦')).toBeVisible();
    await page.goto('/child/home');
    await expectChildHome(page, '小米');

    await logoutChild(page);
    await page.goto('/');
    await expect(page.getByText('欢迎回来，林悦')).toBeVisible();
  });

  test('a child signed in alone who opens a parent page lands on the child’s home, and the parents’ api is closed to the child', async ({
    page,
    openParentPage,
    request,
  }) => {
    const linyue = await familyWithXiaomiWithPassword(openParentPage, request);
    const { admin, family, child } = linyue;
    await xiaomiSignsIn(page, linyue);

    const parentPage = childrenPage(family.id);
    await page.goto(parentPage);
    await expect(page).toHaveURL(`/?returnTo=${encodeURIComponent(parentPage)}`);
    await expectChildHome(page, '小米');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.goto('/');
    await expectChildHome(page, '小米');

    await expectError(page.request.get(childrenApi(family.id)), 401, 'unauthenticated');
    await expectError(
      page.request.delete(childrenApi(family.id, child.id), { headers: sentFrom(page) }),
      401,
      'unauthenticated',
    );
    await expectError(page.request.get('/api/me'), 401, 'unauthenticated');
    const list = await admin.request.get(childrenApi(family.id));
    expect(childListSchema.parse(await list.json())).toEqual([child]);
  });
});

// The child login as a deployed site answers it, without signing in and
// without changing anything, so these also run as smoke tests on production.
test.describe('the child login on a deployed site', () => {
  test(
    'opens at /child with 孩子登录, without errors or CSP violations',
    { tag: ['@smoke', '@production-safe'] },
    async ({ page }) => {
      const problems = await collectPageProblems(page);

      const response = await page.goto('/child');

      expect(response?.ok()).toBe(true);
      await expect(page).toHaveTitle('孩子登录 - 好奇星球');
      await expect(page.getByRole('heading', { level: 1, name: '孩子登录' })).toBeVisible();
      await settle(page);
      expect(problems).toEqual([]);
    },
  );

  test(
    'GET /api/child-auth/remembered through the web origin without a device cookie answers 200 with no children',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request }) => {
      const response = await request.get('/api/child-auth/remembered');

      expect(response.status()).toBe(200);
      expect(rememberedChildListSchema.parse(await response.json())).toEqual([]);
    },
  );
});
