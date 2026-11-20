import { isStep, stepTrailer, type Step } from './commit-message.ts';

/** What each step may change, from the workflow's step table. */
const STEP_TABLE: Record<Step, { allows: (file: string) => boolean; description: string }> = {
  kickoff: {
    allows: (file) => file === '.docs/brief.md' || file.startsWith('.docs/reference/'),
    description: '.docs/brief.md and .docs/reference/',
  },
  architect: {
    allows: (file) => file === '.docs/architecture.md' || file.startsWith('.docs/decisions/'),
    description: '.docs/architecture.md and .docs/decisions/',
  },
  design: {
    allows: (file) => file.startsWith('.docs/design/'),
    description: '.docs/design/',
  },
  scaffold: {
    allows: (file) => !file.startsWith('.docs/'),
    description: 'files outside .docs/',
  },
  implement: {
    allows: (file) => !file.startsWith('.docs/'),
    description: 'files outside .docs/',
  },
};

/**
 * Problems of one commit against the step table: the step named by its
 * `Step:` trailer must exist and may change every file the commit changes.
 * A commit without the trailer counts as a code step.
 */
export function stepProblems(message: string, files: readonly string[]): string[] {
  const trailer = stepTrailer(message);
  if (trailer !== undefined && !isStep(trailer)) {
    return [`"Step: ${trailer}" names no step.`];
  }
  const step = trailer ?? 'implement';
  const { allows, description } = STEP_TABLE[step];
  const outside = files.filter((file) => !allows(file));
  if (outside.length === 0) {
    return [];
  }
  const label =
    trailer === undefined
      ? 'A commit without a "Step:" trailer is a code step and'
      : `The ${step} step`;
  return [`${label} may change only ${description}, not: ${outside.join(', ')}`];
}
