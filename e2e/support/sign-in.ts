import { expect, type Page } from '@playwright/test';

/** Someone at the mock identity provider: the subject and the claims of their ID token. */
export interface MockUser {
  subject: string;
  claims: Record<string, unknown>;
}

/** A new user of the mock identity provider, named and with an email. */
export function newUser(name: string): MockUser {
  const subject = `user-${crypto.randomUUID()}`;
  return { subject, claims: { name, email: `${subject}@example.com` } };
}

/**
 * Signs in through the whole login in the browser: the api sends it to the
 * mock identity provider's login page, the user signs in there, and the
 * callback brings the browser back to `returnTo` with the login cookies.
 */
export async function signIn(page: Page, user: MockUser, returnTo = '/'): Promise<void> {
  await page.goto(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.locator('input[name="username"]').fill(user.subject);
  await page.locator('textarea[name="claims"]').fill(JSON.stringify(user.claims));
  await page.locator('form [type="submit"]').click();
  await expect(page).not.toHaveURL(/\/api\/auth\//);
}

/** Creates a family for the signed-in parent through the api, as the create dialog does. */
export async function createFamily(page: Page, name: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post('/api/families', {
    data: { name, timezone: 'Asia/Shanghai' },
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(201);
}
