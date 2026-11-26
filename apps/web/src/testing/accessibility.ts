import axe from 'axe-core';

/** The axe rule tags of WCAG 2.1 level AA, the project's accessibility target. */
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Fails with one line per violation when axe finds a WCAG 2.1 AA problem in
 * `context`. Animations that end are finished first, so colours are checked
 * as they settle rather than half faded in.
 */
export async function expectNoAxeViolations(
  context: Element = document.documentElement,
): Promise<void> {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming().endTime !== Infinity) {
      animation.finish();
    }
  }
  const results = await axe.run(context, { runOnly: { type: 'tag', values: WCAG_21_AA } });
  const violations = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes
        .map((node) => node.target.join(' '))
        .join(', ')})`,
  );
  expect(violations).toEqual([]);
}

/** The element's text without the parts that match the selector, spaces collapsed. */
function textWithout(element: Element, left: string): string {
  const copy = element.cloneNode(true) as Element;
  for (const part of copy.querySelectorAll(left)) {
    part.remove();
  }
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

/** The element's text as it is seen: without what only screen readers get (`sr-only`). */
export function seenText(element: Element): string {
  return textWithout(element, '.sr-only');
}

/** The element's text as screen readers say it: without what is hidden from them. */
export function heardText(element: Element): string {
  return textWithout(element, '[aria-hidden="true"]');
}
