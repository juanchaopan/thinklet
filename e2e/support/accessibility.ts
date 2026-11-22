import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * The ARIA element reflection properties that crash Firefox before 163 when
 * two script worlds of a page read the same element's property
 * (https://bugzilla.mozilla.org/show_bug.cgi?id=2090055). Playwright reads
 * `ariaLabelledByElements` in its own world to find elements by role and
 * name, and axe reads these properties in the page's world, so an element
 * with `aria-labelledby` (the time zone field, a dialog) crashes the page
 * once both have looked at it.
 */
const FIREFOX_CRASHING_REFLECTIONS = [
  'ariaLabelledByElements',
  'ariaDescribedByElements',
  'ariaOwnsElements',
  'ariaControlsElements',
  'ariaFlowToElements',
  'ariaDetailsElements',
  'ariaErrorMessageElements',
];

/**
 * In Firefox, hides those properties from the page's own world, so axe
 * reads the `aria-*` attributes instead and only Playwright's world reads
 * the properties. The web app sets every ARIA relation as an attribute and
 * never reads the properties, so axe judges the same relations.
 */
async function avoidFirefoxReflectionCrash(page: Page): Promise<void> {
  if (page.context().browser()?.browserType().name() !== 'firefox') {
    return;
  }
  await page.evaluate((names) => {
    for (const name of names) {
      Reflect.deleteProperty(Element.prototype, name);
    }
  }, FIREFOX_CRASHING_REFLECTIONS);
}

/**
 * Checks the page against WCAG 2.1 AA, the project's accessibility target.
 * Animations that end are finished first, so colours are checked as they
 * settle rather than half faded in.
 */
export async function expectAccessiblePage(page: Page): Promise<void> {
  await avoidFirefoxReflectionCrash(page);
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
