import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  childLoginLinkSchema,
  childSchema,
  errorResponseSchema,
  type Child,
  type ErrorCode,
} from '@thinklet/contracts';
import { createFamily, familyOfLinyue, type FamilySummary } from './families.ts';
import type { OpenParentPage } from './fixtures.ts';
import { newUser, signIn } from './sign-in.ts';

/** The password the children of the tests set and sign in with. */
export const PASSWORD = 'xm2019abc';

/** The children page of a family. */
export function childrenPage(familyId: string): string {
  return `/families/${familyId}/children`;
}

/** The api of a family's children, or of one of them with `childId`. */
export function childrenApi(familyId: string, childId?: string): string {
  const children = `/api/families/${familyId}/children`;
  return childId ? `${children}/${childId}` : children;
}

/** The Origin header of a write sent from the site the page is on. */
export function sentFrom(page: Page): { Origin: string } {
  return { Origin: new URL(page.url()).origin };
}

/** Adds a child to the family through the api, as the add dialog does, with the guardian's consent. */
export async function addChild(
  page: Page,
  familyId: string,
  nickname: string,
  account: string,
): Promise<Child> {
  const response = await page.request.post(childrenApi(familyId), {
    data: { nickname, account, consent: true },
    headers: sentFrom(page),
  });
  expect(response.status()).toBe(201);
  return childSchema.parse(await response.json());
}

/** Makes a new login link for the child through the api, as showing the QR code does; its address. */
export async function makeLoginLink(page: Page, familyId: string, child: Child): Promise<string> {
  const response = await page.request.post(`${childrenApi(familyId, child.id)}/login-links`, {
    headers: sentFrom(page),
  });
  expect(response.status()).toBe(201);
  return childLoginLinkSchema.parse(await response.json()).url;
}

/**
 * Sets the child's first password `PASSWORD` with a login link, straight
 * through the api, from a client of its own: the login it starts stays with
 * that client, and nothing is remembered.
 */
export async function setPasswordByLink(request: APIRequestContext, link: string): Promise<void> {
  const { origin, pathname } = new URL(link);
  const token = pathname.split('/').at(-1) ?? '';
  const response = await request.post(`/api/child-login-links/${token}/password`, {
    data: { password: PASSWORD, remember: false },
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(200);
}

/** A family with a child in the tests: the page of the parent who runs it, the family and the child. */
export interface FamilyWithChild {
  admin: Page;
  family: FamilySummary;
  child: Child;
}

/** 林悦's family with 小米 (account xiaomi), 林悦 signed in on a page of her own. */
export async function familyWithXiaomi(openParentPage: OpenParentPage): Promise<FamilyWithChild> {
  const { admin, family } = await familyOfLinyue(openParentPage);
  return { admin, family, child: await addChild(admin, family.id, '小米', 'xiaomi') };
}

/**
 * 林悦's family, made by the parent signed in on `admin`, with 小米, who has
 * set the password `PASSWORD` with a first login link from `request`.
 */
export async function familyWithXiaomiOn(
  admin: Page,
  request: APIRequestContext,
): Promise<FamilyWithChild> {
  const family = await createFamily(admin, '林悦的家');
  const child = await addChild(admin, family.id, '小米', 'xiaomi');
  await setPasswordByLink(request, await makeLoginLink(admin, family.id, child));
  return { admin, family, child };
}

/** Like `familyWithXiaomiOn`, with 林悦 signed in on a page of her own. */
export async function familyWithXiaomiWithPassword(
  openParentPage: OpenParentPage,
  request: APIRequestContext,
): Promise<FamilyWithChild> {
  const admin = await openParentPage();
  await signIn(admin, newUser('林悦'));
  return familyWithXiaomiOn(admin, request);
}

/** The row of the child with this nickname on the children page. */
export function childRow(page: Page, nickname: string): Locator {
  return page.getByRole('listitem').filter({ has: page.getByText(nickname, { exact: true }) });
}

/** Chooses one of the child's actions on the children page. */
export async function actOnChild(page: Page, nickname: string, action: string): Promise<void> {
  await childRow(page, nickname).getByRole('button', { name: '更多操作' }).click();
  await page
    .getByRole('menu', { name: `${nickname}的操作` })
    .getByRole('menuitem', { name: action })
    .click();
}

/**
 * Shows the child's login QR code on the children page, and gives the
 * address of the login link it shows, as the api answered it when the
 * dialog made the link: the address the QR code holds, without reading the
 * picture.
 */
export async function showLoginQr(page: Page, nickname: string): Promise<string> {
  const made = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/login-links'),
  );
  await childRow(page, nickname).getByRole('button', { name: '显示登录二维码' }).click();
  const response = await made;
  expect(response.status()).toBe(201);
  const { url } = childLoginLinkSchema.parse(await response.json());
  const dialog = page.getByRole('dialog', { name: `让${nickname}扫码登录` });
  await expect(dialog.getByRole('img', { name: `${nickname}的登录二维码` })).toBeVisible();
  await expect(dialog.getByText('10 分钟内有效，还剩')).toBeVisible();
  return url;
}

/** What the child types into the child login's form. */
export interface ChildCredentials {
  code: string;
  account: string;
  password: string;
}

/**
 * Fills the child login's form shown on the page and signs in, ticking
 * 在这台设备上记住我 when `remember` is set (it starts unticked). The family
 * code goes into its six boxes as typed.
 */
export async function loginWithAccount(
  page: Page,
  { code, account, password }: ChildCredentials,
  remember = false,
): Promise<void> {
  await page.getByRole('textbox', { name: '第 1 位' }).click();
  await page.keyboard.type(code);
  await page.getByRole('textbox', { name: '账号' }).fill(account);
  await page.getByLabel('密码', { exact: true }).fill(password);
  if (remember) {
    await page.getByText('在这台设备上记住我').click();
  }
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

/** Checks that the page is the home page of the signed-in child with this nickname. */
export async function expectChildHome(page: Page, nickname: string): Promise<void> {
  await expect(page.getByText(`你好，${nickname}！`)).toBeVisible();
  await expect(page.getByRole('button', { name: '退出' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '还没有书' })).toBeVisible();
}

/** Signs the child out on the child's home page, which opens the child login. */
export async function logoutChild(page: Page): Promise<void> {
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page).toHaveURL('/child');
}

/** Checks that an api answer is the error with this status and code. */
export async function expectError(
  answer: Promise<APIResponse>,
  status: number,
  code: ErrorCode,
): Promise<void> {
  const response = await answer;
  expect(response.status()).toBe(status);
  expect(errorResponseSchema.parse(await response.json()).error.code).toBe(code);
}
