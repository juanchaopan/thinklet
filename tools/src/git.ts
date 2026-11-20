import { execFileSync } from 'node:child_process';

/** A commit and its parents, first parent first. */
export interface Commit {
  sha: string;
  parents: string[];
}

/** Runs git in the given directory and returns what it prints. */
export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function paths(output: string): string[] {
  return output.split('\0').filter((path) => path !== '');
}

/** Lists file names, one per changed path; a rename counts as a deletion and an addition. */
const NAMES = ['--name-only', '--no-renames', '-z'];

/**
 * The branch being checked: on a GitHub pull request the head branch
 * (GITHUB_HEAD_REF, as the checkout is detached there), otherwise the
 * checked-out branch; empty on a detached HEAD.
 */
export function currentBranch(cwd: string): string {
  const headRef = process.env['GITHUB_HEAD_REF'];
  if (headRef) {
    return headRef;
  }
  try {
    return git(cwd, ['branch', '--show-current']).trim();
  } catch {
    return '';
  }
}

/** Files the next commit changes. */
export function stagedFiles(cwd: string): string[] {
  return paths(git(cwd, ['diff', '--cached', ...NAMES]));
}

/** The commits reachable from head but not from base, oldest first. */
export function commitsBetween(cwd: string, base: string, head: string): Commit[] {
  return git(cwd, ['rev-list', '--reverse', '--parents', `${base}..${head}`])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', ...parents] = line.split(' ');
      return { sha, parents };
    });
}

/** Files a commit changes compared with its first parent (all files for a root commit). */
export function commitFiles(cwd: string, commit: Commit): string[] {
  const args =
    commit.parents.length === 0
      ? ['diff-tree', '--root', '--no-commit-id', '-r', ...NAMES, commit.sha]
      : ['diff', ...NAMES, `${commit.sha}^1`, commit.sha];
  return paths(git(cwd, args));
}

/** The full message of a commit. */
export function commitMessage(cwd: string, sha: string): string {
  return git(cwd, ['log', '-1', '--format=%B', sha]);
}

/** Whether `ancestor` is reachable from `descendant`; false when either does not exist. */
export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/** The commit a merge in progress brings in, if a merge is in progress. */
export function mergeHead(cwd: string): string | undefined {
  try {
    return git(cwd, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD']).trim();
  } catch {
    return undefined;
  }
}

/** Files changed on HEAD's side since it branched off base. */
export function changedFiles(cwd: string, base: string): string[] {
  return paths(git(cwd, ['diff', ...NAMES, `${base}...HEAD`]));
}

/**
 * Files under the pathspec that the working tree adds compared with where it
 * branched off base: added in commits, staged or not, and untracked ones.
 */
export function addedFiles(cwd: string, base: string, pathspec: string): string[] {
  const added = git(cwd, [
    'diff',
    ...NAMES,
    '--diff-filter=A',
    '--merge-base',
    base,
    '--',
    pathspec,
  ]);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', pathspec]);
  return [...new Set([...paths(added), ...paths(untracked)])];
}

/** Files under the pathspec in the working tree, tracked or untracked but not ignored. */
export function workingFiles(cwd: string, pathspec: string): string[] {
  return paths(
    git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', pathspec]),
  );
}
