import axe from 'axe-core';

/** The axe rule tags of WCAG 2.1 level AA, the project's accessibility target. */
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fails with one line per violation when axe finds a WCAG 2.1 AA problem in `context`. */
export async function expectNoAxeViolations(
  context: Element = document.documentElement,
): Promise<void> {
  const results = await axe.run(context, { runOnly: { type: 'tag', values: WCAG_21_AA } });
  const violations = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes
        .map((node) => node.target.join(' '))
        .join(', ')})`,
  );
  expect(violations).toEqual([]);
}
