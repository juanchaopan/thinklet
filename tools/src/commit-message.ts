import conventional from '@commitlint/config-conventional';
import { COMMIT_TYPE, type Branch } from './branch.ts';

/** The steps every issue goes through, in order. */
export const STEPS = ['kickoff', 'architect', 'design', 'scaffold', 'implement'] as const;
export type Step = (typeof STEPS)[number];

// The commit types and line limits are read from the commitlint preset that
// checks commit messages, so PR titles follow exactly the same rules.
const COMMIT_TYPES: readonly string[] = conventional.rules['type-enum'][2];
const MAX_TITLE_LENGTH = conventional.rules['header-max-length'][2];
/** The longest a line after the title may be, unless it holds a URL. */
const MAX_LINE_LENGTH = conventional.rules['body-max-line-length'][2];

const CONVENTIONAL_TITLE = /^([a-z]+)(?:\([^()\s][^()]*\))?!?: \S/;
const ISSUE_REFERENCE = / \(#(\d+)\)$/;
const DEPENDENCY_TITLE = /^(fix|chore)\(deps\): \S/;
const STEP_TRAILER = /^Step: (\S+)$/;
const SCISSORS = /^# -+ >8 -+$/;
const URL = /\bhttps?:\/\/\S/;
const MERGE_FROM_MAIN = /^Merge (?:remote-tracking )?branch '(?:origin\/)?main'(?: into \S+)?$/;

/**
 * The lines of a commit message as git stores it: without the comment lines
 * git adds for the editor, without everything below a scissors line, and
 * without trailing blank lines.
 */
export function messageLines(raw: string): string[] {
  const lines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (SCISSORS.test(line)) {
      break;
    }
    if (!line.startsWith('#')) {
      lines.push(line.trimEnd());
    }
  }
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

/** The value of the `Step:` trailer in the message's last paragraph, if there is one. */
export function stepTrailer(raw: string): string | undefined {
  const lines = messageLines(raw);
  const lastParagraph = lines.slice(lines.lastIndexOf('') + 1);
  for (const line of lastParagraph) {
    const match = STEP_TRAILER.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

/** Whether the value names one of the steps. */
export function isStep(value: string): value is Step {
  return (STEPS as readonly string[]).includes(value);
}

/** The project's first commit, made on main before any issue exists. */
export function isProjectStart(raw: string): boolean {
  const lines = messageLines(raw);
  return lines[0] === 'chore: start the project' && lines.at(-1) === 'Step: kickoff';
}

/** A merge commit that brings main into the branch, as git and GitHub word it. */
export function isMergeFromMain(raw: string): boolean {
  return MERGE_FROM_MAIN.test(messageLines(raw)[0] ?? '');
}

/** Problems of a title (a commit's first line or a PR title) that hold on every branch. */
export function conventionalTitleProblems(title: string): string[] {
  const problems: string[] = [];
  if (title.length > MAX_TITLE_LENGTH) {
    problems.push(
      `The title has ${title.length} characters; at most ${MAX_TITLE_LENGTH} are allowed.`,
    );
  }
  const match = CONVENTIONAL_TITLE.exec(title);
  if (!match?.[1]) {
    problems.push('The title must read "<type>(<scope>): <subject>", the scope being optional.');
  } else if (!COMMIT_TYPES.includes(match[1])) {
    problems.push(`"${match[1]}" is not a commit type; use one of ${COMMIT_TYPES.join(', ')}.`);
  }
  return problems;
}

/** Problems of a title that come from the kind of branch it is on. */
export function branchTitleProblems(title: string, branch: Branch): string[] {
  switch (branch.kind) {
    case 'issue':
      return issueTitleProblems(title, branch.issueType, branch.issueNumber);
    case 'release':
      return title === `chore(release): ${branch.version}`
        ? []
        : [`A release branch's title is exactly "chore(release): ${branch.version}".`];
    case 'dependencies':
      return dependencyTitleProblems(title);
    case 'scratch':
    case 'other':
      return [];
  }
}

function issueTitleProblems(
  title: string,
  issueType: keyof typeof COMMIT_TYPE,
  issueNumber: string,
): string[] {
  const problems: string[] = [];
  const type = CONVENTIONAL_TITLE.exec(title)?.[1];
  const expectedType = COMMIT_TYPE[issueType];
  if (type !== undefined && type !== expectedType) {
    problems.push(`A ${issueType} issue's type is "${expectedType}", not "${type}".`);
  }
  const reference = ISSUE_REFERENCE.exec(title)?.[1];
  if (reference !== issueNumber) {
    problems.push(`The title must end with " (#${issueNumber})", the number of the issue branch.`);
  }
  return problems;
}

function dependencyTitleProblems(title: string): string[] {
  const problems: string[] = [];
  if (!DEPENDENCY_TITLE.test(title)) {
    problems.push('A dependency update\'s title starts with "fix(deps): " or "chore(deps): ".');
  }
  if (/\(#\d+\)$/.test(title)) {
    problems.push('A dependency update carries no issue number.');
  }
  return problems;
}

/** Problems of a commit message's body and trailers that come from the kind of branch. */
export function branchMessageProblems(raw: string, branch: Branch): string[] {
  const lines = messageLines(raw);
  if (branch.kind === 'issue') {
    const last = lines.length > 1 ? (lines.at(-1) ?? '') : '';
    const step = STEP_TRAILER.exec(last)?.[1];
    if (step === undefined) {
      return [`The last line must be "Step: <step>", the step being one of ${STEPS.join(', ')}.`];
    }
    return isStep(step) ? [] : [`"${step}" is not a step; use one of ${STEPS.join(', ')}.`];
  }
  if (branch.kind === 'dependencies' && lines.some((line) => STEP_TRAILER.test(line))) {
    return ['A dependency update carries no "Step:" trailer.'];
  }
  return [];
}

/** Lines after the title that are longer than allowed and hold no URL. */
export function lineLengthProblems(raw: string): string[] {
  return messageLines(raw)
    .slice(1)
    .filter((line) => line.length > MAX_LINE_LENGTH && !URL.test(line))
    .map(
      (line) =>
        `This line has ${line.length} characters; at most ${MAX_LINE_LENGTH} are allowed unless it holds a URL: "${line.slice(0, 40)}..."`,
    );
}
