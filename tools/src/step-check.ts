import {
  commitFiles,
  commitMessage,
  commitsBetween,
  isAncestor,
  mergeHead,
  stagedFiles,
  type Commit,
} from './git.ts';
import { stepProblems } from './steps.ts';

export interface CommitProblems {
  commit: string;
  problems: string[];
}

/** A merge commit whose other parents are all on main: what it brings in was checked there. */
function bringsMainIn(cwd: string, commit: Commit, main: string): boolean {
  const others = commit.parents.slice(1);
  return others.length > 0 && others.every((parent) => isAncestor(cwd, parent, main));
}

/** Checks every commit in `base..head` against the step table, skipping merges that bring main in. */
export function checkRange(cwd: string, base: string, head: string): CommitProblems[] {
  const found: CommitProblems[] = [];
  for (const commit of commitsBetween(cwd, base, head)) {
    if (bringsMainIn(cwd, commit, base)) {
      continue;
    }
    const problems = stepProblems(commitMessage(cwd, commit.sha), commitFiles(cwd, commit));
    if (problems.length > 0) {
      found.push({ commit: commit.sha, problems });
    }
  }
  return found;
}

/**
 * Checks the commit being made (the staged files and its message) against
 * the step table. Concluding a merge of main is not checked.
 */
export function checkStaged(cwd: string, message: string, mainRefs: readonly string[]): string[] {
  const merging = mergeHead(cwd);
  if (merging !== undefined && mainRefs.some((ref) => isAncestor(cwd, merging, ref))) {
    return [];
  }
  return stepProblems(message, stagedFiles(cwd));
}
