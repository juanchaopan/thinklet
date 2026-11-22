import { test as base, type BrowserContext, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Opens a page in a browser context of its own, for another parent signed in
 * at the same time as the one on `page`: each context keeps its own login
 * cookies.
 */
export type OpenParentPage = () => Promise<Page>;

/**
 * Playwright's `test` with `openParentPage`. Every context it opens gets the
 * project's and the test's options, as `page`'s own does, and is closed when
 * the test ends: a context left open keeps its page running for the rest of
 * the worker, and in WebKit a later test's clicks and focus then hang.
 */
export const test = base.extend<{ openParentPage: OpenParentPage }>({
  openParentPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});
