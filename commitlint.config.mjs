import { parseBranch } from './tools/src/branch.ts';
import {
  branchMessageProblems,
  branchTitleProblems,
  isMergeFromMain,
  isProjectStart,
  lineLengthProblems,
} from './tools/src/commit-message.ts';
import { currentBranch } from './tools/src/git.ts';

// Commit messages (`task commits`, and the commit-msg hook): Conventional
// Commits plus the project's rules for the kind of branch the commits are on
// (GITHUB_HEAD_REF on a pull request, else the checked-out branch). The same
// title rules check PR titles (tools/bin/pr-title.ts).
//   issue branch <type>/<n>-<name>  the type of the issue type, " (#<n>)" at the end of the
//                                   first line, and "Step: <step>" as the last line
//   release/<version>               "chore(release): <version>"
//   renovate/*                      "fix(deps): ..." or "chore(deps): ...", no issue number
//                                   and no Step trailer
//   scratch/* and any other branch  Conventional Commits only
// Merges that bring main in are not checked, and the project's first commit
// ("chore: start the project", "Step: kickoff") always passes.

const branch = parseBranch(currentBranch(process.cwd()));

/** A commitlint rule outcome from a list of problems. */
const outcome = (problems) => [problems.length === 0, problems.join(' ')];

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: false,
  ignores: [isMergeFromMain],
  plugins: [
    {
      rules: {
        'project-branch-title': ({ raw, header }) =>
          outcome(isProjectStart(raw ?? '') ? [] : branchTitleProblems(header ?? '', branch)),
        'project-branch-message': ({ raw }) =>
          outcome(isProjectStart(raw ?? '') ? [] : branchMessageProblems(raw ?? '', branch)),
        'project-line-length': ({ raw }) => outcome(lineLengthProblems(raw ?? '')),
      },
    },
  ],
  rules: {
    // Lines that hold a URL may be longer (project-line-length).
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'project-branch-title': [2, 'always'],
    'project-branch-message': [2, 'always'],
    'project-line-length': [2, 'always'],
  },
};
