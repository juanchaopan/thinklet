import type { Page } from '@playwright/test';

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

/** The mock identity provider's login form, where a user enters who they are. */
export function providerLoginForm(page: Page) {
  return page.locator('input[name="username"]');
}

/**
 * Signs in on the mock identity provider's login page the browser is on,
 * and waits until the callback has brought the browser back to the site:
 * the origin the provider was asked to send the browser back to
 * (`redirect_uri`).
 */
export async function signInAtProvider(page: Page, user: MockUser): Promise<void> {
  const callback = new URL(page.url()).searchParams.get('redirect_uri');
  if (!callback) {
    throw new Error('The browser is not on the identity provider’s login page');
  }
  const site = new URL(callback).origin;
  await providerLoginForm(page).fill(user.subject);
  await page.locator('textarea[name="claims"]').fill(JSON.stringify(user.claims));
  await page.locator('form [type="submit"]').click();
  await page.waitForURL((url) => url.origin === site && !url.pathname.startsWith('/api/auth/'));
}

/**
 * Signs in through the whole login in the browser: the api sends it to the
 * mock identity provider's login page, the user signs in there, and the
 * callback brings the browser back to `returnTo` with the login cookies.
 */
export async function signIn(page: Page, user: MockUser, returnTo = '/'): Promise<void> {
  await page.goto(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await signInAtProvider(page, user);
}
