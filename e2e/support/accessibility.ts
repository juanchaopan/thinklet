import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Checks the page against WCAG 2.1 AA, the project's accessibility target.
 * Animations that end are finished first, so colours are checked as they
 * settle rather than half faded in.
 */
export async function expectAccessiblePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().endTime !== Infinity) {
        animation.finish();
      }
    }
  });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}
