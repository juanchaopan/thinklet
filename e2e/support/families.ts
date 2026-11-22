import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';

/** What the end-to-end tests need of a family, read through the api. */
export interface FamilySummary {
  id: string;
  name: string;
  code: string;
  timezone: string;
  role: string;
}

/**
 * A page in a browser of its own, for a second parent signed in at the same
 * time as the first: each browser context keeps its own login cookies.
 */
export async function pageOfAnotherParent(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const { baseURL, locale, timezoneId } = testInfo.project.use;
  const context = await browser.newContext({ baseURL, locale, timezoneId });
  return context.newPage();
}

/** The signed-in parent's first family, as its members see it. */
export async function firstFamily(page: Page): Promise<FamilySummary> {
  const me = (await (await page.request.get('/api/me')).json()) as {
    families: Array<{ id: string }>;
  };
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
  const list = (await (
    await page.request.get(`/api/families/${familyId}/join-requests`)
  ).json()) as { pending: Array<{ id: string }> };
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
