import { expect, type Locator, type Page } from '@playwright/test';
import type { OpenParentPage } from './fixtures.ts';
import { newUser, signIn } from './sign-in.ts';

/** What the end-to-end tests need of a family, read through the api. */
export interface FamilySummary {
  id: string;
  name: string;
  code: string;
  timezone: string;
  role: string;
}

/** Creates a family for the signed-in parent through the api, as the create dialog does. */
export async function createFamily(
  page: Page,
  name: string,
  timezone = 'Asia/Shanghai',
): Promise<FamilySummary> {
  const response = await page.request.post('/api/families', {
    data: { name, timezone },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as FamilySummary;
}

/** The signed-in parent's first family, as its members see it. */
export async function firstFamily(page: Page): Promise<FamilySummary> {
  const meResponse = await page.request.get('/api/me');
  expect(meResponse.status()).toBe(200);
  const me = (await meResponse.json()) as { families: Array<{ id: string }> };
  const familyId = me.families.at(0)?.id;
  if (!familyId) {
    throw new Error('The parent has no family');
  }
  const response = await page.request.get(`/api/families/${familyId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as FamilySummary;
}

/**
 * Approves or rejects the request waiting in the family, as its admin does
 * on the new members page, straight through the api.
 */
export async function handleWaitingRequest(
  page: Page,
  familyId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  const listResponse = await page.request.get(`/api/families/${familyId}/join-requests`);
  expect(listResponse.status()).toBe(200);
  const list = (await listResponse.json()) as { pending: Array<{ id: string }> };
  const requestId = list.pending.at(0)?.id;
  if (!requestId) {
    throw new Error('No request is waiting in the family');
  }
  const response = await page.request.post(
    `/api/families/${familyId}/join-requests/${requestId}/${decision}`,
    { headers: { Origin: new URL(page.url()).origin } },
  );
  expect(response.status()).toBe(200);
}

/** The card of the applicant's request to the family with this name. */
export function requestCard(page: Page, familyName: string) {
  return page.locator('[appcard]', { hasText: familyName });
}

/**
 * Asks to join the family with the code from the page the parent is on (the
 * start page or the join page), typing it into the six boxes.
 */
export async function askToJoin(page: Page, code: string): Promise<void> {
  await page.getByRole('button', { name: /^申请加入家庭/ }).click();
  await expect(page.getByRole('textbox', { name: '第 1 位' })).toBeFocused();
  await page.keyboard.type(code.toLowerCase());
  const confirm = page.getByRole('dialog', { name: '申请加入这个家庭？' });
  await confirm.getByRole('button', { name: '发送申请' }).click();
  await expect(page.getByText('申请已发出')).toBeVisible();
}

/** Brings the page's window back to the front, as switching back to its tab does. */
export async function bringToFront(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/**
 * Picks a time zone in the create dialog's 时区 field by searching for it
 * and taking the first one found, then checks what the field shows.
 */
export async function pickTimeZone(
  page: Page,
  dialog: Locator,
  search: string,
  shown: string,
): Promise<void> {
  const timeZone = dialog.getByRole('button', { name: /^时区/ });
  await timeZone.click();
  await page.getByRole('combobox', { name: '搜索时区' }).fill(search);
  await page.keyboard.press('Enter');
  await expect(timeZone).toHaveText(shown);
}

/** Switches to the family with this name in the family menu of the current family. */
export async function switchFamily(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('button', { name: `${from} 切换家庭` }).click();
  await page
    .getByRole('menu', { name: '切换家庭' })
    .getByRole('menuitem', { name: new RegExp(`^${to}`) })
    .click();
  await expect(page.getByRole('button', { name: `${to} 切换家庭` })).toBeVisible();
}

/** 林悦's family, with 林悦 signed in as its admin on a page of her own. */
export async function familyOfLinyue(
  openParentPage: OpenParentPage,
): Promise<{ admin: Page; family: FamilySummary }> {
  const admin = await openParentPage();
  await signIn(admin, newUser('林悦'));
  return { admin, family: await createFamily(admin, '林悦的家') };
}

/** 林悦's family, which 周子航, signed in on `page`, has asked to join. */
export async function requestOfZihang(page: Page, openParentPage: OpenParentPage) {
  const linyue = await familyOfLinyue(openParentPage);
  await signIn(page, newUser('周子航'));
  await askToJoin(page, linyue.family.code);
  return linyue;
}

/** 林悦's family with 周子航, signed in on `page`, as one of its members. */
export async function familyWithZihang(page: Page, openParentPage: OpenParentPage) {
  const linyue = await requestOfZihang(page, openParentPage);
  await handleWaitingRequest(linyue.admin, linyue.family.id, 'approve');
  return linyue;
}
