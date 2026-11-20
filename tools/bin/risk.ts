import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseBranch } from '../src/branch.ts';
import { changedFiles, currentBranch } from '../src/git.ts';
import { parseRiskRules, riskTier } from '../src/risk.ts';

// Prints the PR's risk tier: low, medium or high, for the repository in the
// current directory.
//   --base <ref>     the changed files are those of HEAD since it branched off <ref>
//   --rules <file>   the rules (default risk-rules.yml; CI passes the target branch's copy)
//   --branch <name>  the head branch, if not GITHUB_HEAD_REF or the checked-out one

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    rules: { type: 'string', default: 'risk-rules.yml' },
    branch: { type: 'string' },
  },
});
if (values.base === undefined) {
  console.error('Pass --base <ref>.');
  process.exit(2);
}
const cwd = process.cwd();
const files = changedFiles(cwd, values.base);
const rules = parseRiskRules(readFileSync(values.rules, 'utf8'));

console.log(riskTier(files, parseBranch(values.branch ?? currentBranch(cwd)), rules));
