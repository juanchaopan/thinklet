import { parseArgs } from 'node:util';
import { parseBranch } from '../src/branch.ts';
import { branchTitleProblems, conventionalTitleProblems } from '../src/commit-message.ts';

// The PR title check: the same title rules as commitlint applies to commit
// messages, for the kind of the PR's head branch. A PR from a branch of no
// known kind fails.
//   --title <title> --branch <head branch>

const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    branch: { type: 'string' },
  },
});
if (values.title === undefined || values.branch === undefined) {
  console.error('Pass --title <title> and --branch <head branch>.');
  process.exit(2);
}

const branch = parseBranch(values.branch);
const problems =
  branch.kind === 'other'
    ? [
        `"${values.branch}" is not an issue branch (<type>/<number>-<name>), release/<version>, renovate/* or scratch/* branch.`,
      ]
    : [...conventionalTitleProblems(values.title), ...branchTitleProblems(values.title, branch)];

if (problems.length > 0) {
  console.error(
    [`PR title "${values.title}" fails:`, ...problems.map((problem) => `  ${problem}`)].join('\n'),
  );
  process.exit(1);
}
console.log('PR title check passed.');
