import { matchesGlob } from 'node:path/posix';
import type { Branch } from './branch.ts';

export interface RiskRules {
  high: string[];
  low: string[];
}

export type RiskTier = 'low' | 'medium' | 'high';

const LIST_KEY = /^(high|low):\s*$/;
const LIST_ITEM = /^\s+-\s+(['"])(.+)\1\s*$/;

/**
 * Reads risk-rules.yml. The file is kept to a small subset of YAML, two
 * lists of quoted glob patterns under `high:` and `low:`, with comment and
 * blank lines; anything else is an error naming the line.
 */
export function parseRiskRules(text: string): RiskRules {
  const rules: Partial<RiskRules> = {};
  let current: string[] | undefined;
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      return;
    }
    const key = LIST_KEY.exec(line)?.[1] as keyof RiskRules | undefined;
    const item = LIST_ITEM.exec(line)?.[2];
    if (key !== undefined && rules[key] === undefined) {
      current = rules[key] = [];
    } else if (item !== undefined && current !== undefined) {
      current.push(item);
    } else {
      throw new Error(
        `Line ${index + 1} is not "high:", "low:" or a quoted pattern under one of them: ${line}`,
      );
    }
  });
  if (rules.high === undefined || rules.low === undefined) {
    throw new Error('The rules need both a "high:" and a "low:" list.');
  }
  return { high: rules.high, low: rules.low };
}

// Node's glob skips names that start with a dot unless the pattern spells
// the dot out. Risk rules are paths, so `**/*.md` must also reach
// .docs/x.md: a leading dot is swapped for a character no path uses, in the
// file and the pattern alike.
const HIDDEN_DOT = '';

function revealDots(path: string): string {
  return path.replace(/(^|\/)\./g, `$1${HIDDEN_DOT}`);
}

/** Whether a repository-relative path matches a glob pattern; `*` and `**` also match dot names. */
export function matchesPattern(file: string, pattern: string): boolean {
  return matchesGlob(revealDots(file), revealDots(pattern));
}

/**
 * The PR's risk tier: high when any file matches a high-risk pattern or the
 * PR is a release; low when every file matches a low-risk pattern; medium
 * otherwise, also when no file changed.
 */
export function riskTier(files: readonly string[], branch: Branch, rules: RiskRules): RiskTier {
  const matchesAny = (file: string, patterns: readonly string[]) =>
    patterns.some((pattern) => matchesPattern(file, pattern));
  if (branch.kind === 'release' || files.some((file) => matchesAny(file, rules.high))) {
    return 'high';
  }
  if (files.length > 0 && files.every((file) => matchesAny(file, rules.low))) {
    return 'low';
  }
  return 'medium';
}
