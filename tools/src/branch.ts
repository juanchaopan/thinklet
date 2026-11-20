/** The kinds of branch the project's checks tell apart, from the workflow's branch rules. */
export type Branch =
  | { kind: 'issue'; issueType: IssueType; issueNumber: string }
  | { kind: 'scratch' }
  | { kind: 'release'; version: string }
  | { kind: 'dependencies' }
  | { kind: 'other' };

export type IssueType = 'feature' | 'fix' | 'refactor' | 'maintenance';

/** The Conventional Commits type each issue type's commits and PR title use. */
export const COMMIT_TYPE: Record<IssueType, string> = {
  feature: 'feat',
  fix: 'fix',
  refactor: 'refactor',
  maintenance: 'chore',
};

const ISSUE_BRANCH = /^(feature|fix|refactor|maintenance)\/(\d+)-[^/\s]+$/;
const RELEASE_BRANCH = /^release\/(\S+)$/;

/** Reads the kind of a branch from its name, e.g. `feature/12-order-filter`. */
export function parseBranch(name: string): Branch {
  const issue = ISSUE_BRANCH.exec(name);
  if (issue?.[1] && issue[2]) {
    return { kind: 'issue', issueType: issue[1] as IssueType, issueNumber: issue[2] };
  }
  if (name.startsWith('scratch/')) {
    return { kind: 'scratch' };
  }
  const release = RELEASE_BRANCH.exec(name);
  if (release?.[1]) {
    return { kind: 'release', version: release[1] };
  }
  if (name.startsWith('renovate/')) {
    return { kind: 'dependencies' };
  }
  return { kind: 'other' };
}
