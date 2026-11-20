import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseBranch } from '../src/branch.ts';
import { changedFiles, currentBranch } from '../src/git.ts';
import { parseRiskRules, riskTier } from '../src/risk.ts';

// Prints the PR's risk tier: low, medium or high.
//   --base <ref>     the changed files are those of HEAD since it branched off <ref>;
//                    without it they are read from standard input, one per line
//   --rules <file>   the rules (default risk-rules.yml; CI passes the target branch's copy)
//   --branch <name>  the head branch, if not GITHUB_HEAD_REF or the checked-out one

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    rules: { type: 'string', default: 'risk-rules.yml' },
    branch: { type: 'string' },
  },
});
const cwd = process.cwd();
const files =
  values.base === undefined
    ? readFileSync(0, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
    : changedFiles(cwd, values.base);
const rules = parseRiskRules(readFileSync(values.rules, 'utf8'));

console.log(riskTier(files, parseBranch(values.branch ?? currentBranch(cwd)), rules));
