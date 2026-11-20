import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseBranch } from '../src/branch.ts';
import { currentBranch } from '../src/git.ts';
import { checkRange, checkStaged } from '../src/step-check.ts';

// The step check: each commit on an issue branch may change only the files
// its step may change.
//   --message-file <file>       commit-msg hook: the staged files and the message being written
//   --base <ref> [--head <ref>] CI: every commit in <base>..<head> (head defaults to HEAD)
//   --branch <name>             the branch, if not GITHUB_HEAD_REF or the checked-out one

const { values } = parseArgs({
  options: {
    'message-file': { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string', default: 'HEAD' },
    branch: { type: 'string' },
  },
});
const cwd = process.cwd();
const branchName = values.branch ?? currentBranch(cwd);

if (parseBranch(branchName).kind !== 'issue') {
  console.log(`Step check: "${branchName}" is not an issue branch; nothing to check.`);
  process.exit(0);
}

let problems: string[];
if (values['message-file'] !== undefined) {
  const message = readFileSync(values['message-file'], 'utf8');
  problems = checkStaged(cwd, message, ['origin/main', 'main']);
} else if (values.base !== undefined) {
  problems = checkRange(cwd, values.base, values.head).flatMap(({ commit, problems: found }) =>
    found.map((problem) => `${commit.slice(0, 12)}: ${problem}`),
  );
} else {
  console.error('Pass --message-file <file> or --base <ref>.');
  process.exit(2);
}

if (problems.length > 0) {
  console.error(['Step check failed:', ...problems.map((problem) => `  ${problem}`)].join('\n'));
  process.exit(1);
}
console.log('Step check passed.');
