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
