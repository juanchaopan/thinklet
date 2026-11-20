import { describe, expect, it } from 'vitest';
import { parseBranch } from './branch.ts';
import {
  branchMessageProblems,
  branchTitleProblems,
  conventionalTitleProblems,
  isMergeFromMain,
  isProjectStart,
  lineLengthProblems,
  messageLines,
  stepTrailer,
} from './commit-message.ts';

const issue = parseBranch('maintenance/1-set-up-the-project');
const valid = [
  'chore(scaffold): add the checks (#1)',
  '',
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  'Claude-Session: https://claude.ai/code/session_0183GQ8EYBycuzVPJTFpvgQ1',
  'Step: scaffold',
  '',
].join('\n');

describe('messageLines', () => {
  it('drops comment lines, everything below the scissors line and trailing blank lines', () => {
    const raw = [
      'feat: a (#1)',
      '# Please enter the commit message',
      '',
      'Step: implement',
      '',
      '# ------------------------ >8 ------------------------',
      'diff --git a/x b/x',
    ].join('\n');

    expect(messageLines(raw)).toEqual(['feat: a (#1)', '', 'Step: implement']);
  });
});

describe('stepTrailer', () => {
  it('reads the Step trailer of the last paragraph', () => {
    expect(stepTrailer(valid)).toBe('scaffold');
    expect(stepTrailer('docs: a (#1)\n\nStep: design\nCo-Authored-By: someone')).toBe('design');
  });

  it('ignores a Step line outside the last paragraph and finds none in a one-line message', () => {
    expect(stepTrailer('feat: a (#1)\n\nStep: design\n\nmore text')).toBeUndefined();
    expect(stepTrailer('feat: a (#1)')).toBeUndefined();
  });
});

describe('isProjectStart and isMergeFromMain', () => {
  it('recognises the first commit of the project', () => {
    expect(isProjectStart('chore: start the project\n\nStep: kickoff\n')).toBe(true);
    expect(isProjectStart('chore: start the project\n')).toBe(false);
  });

  it.each([
    "Merge branch 'main' into feature/12-order-filter",
    "Merge remote-tracking branch 'origin/main' into feature/12-order-filter",
    "Merge branch 'main'",
  ])('recognises %j as a merge of main', (message) => {
    expect(isMergeFromMain(message)).toBe(true);
  });

  it('does not take a merge of another branch for one', () => {
    expect(isMergeFromMain("Merge branch 'feature/3-x' into feature/12-order-filter")).toBe(false);
  });
});

describe('conventionalTitleProblems', () => {
  it.each(['chore(scaffold): add the checks (#1)', 'feat!: drop the old login (#3)', 'fix: a'])(
    'accepts %j',
    (title) => {
      expect(conventionalTitleProblems(title)).toEqual([]);
    },
  );

  it.each([
    ['no type', 'add the checks'],
    ['no space after the colon', 'chore:add'],
    ['an empty scope', 'chore(): add'],
    ['an upper-case type', 'Chore: add'],
  ])('rejects a title with %s', (_name, title) => {
    expect(conventionalTitleProblems(title)).toEqual([expect.stringContaining('<type>')]);
  });

  it('rejects an unknown type and a title over 100 characters', () => {
    expect(conventionalTitleProblems('wip: add')).toEqual([expect.stringContaining('"wip"')]);
    expect(conventionalTitleProblems(`chore: ${'a'.repeat(94)}`)).toEqual([
      expect.stringContaining('101 characters'),
    ]);
  });
});

describe('branchTitleProblems', () => {
  it('accepts an issue title with the matching type and issue number', () => {
    expect(branchTitleProblems('chore(scaffold): add the checks (#1)', issue)).toEqual([]);
    expect(branchTitleProblems('feat!: drop it (#12)', parseBranch('feature/12-x'))).toEqual([]);
  });

  it.each([
    ['feature', 'feat'],
    ['fix', 'fix'],
    ['refactor', 'refactor'],
    ['maintenance', 'chore'],
  ])('asks a %s issue for the type %s', (issueType, type) => {
    const branch = parseBranch(`${issueType}/5-x`);

    expect(branchTitleProblems(`${type}: a (#5)`, branch)).toEqual([]);
    expect(branchTitleProblems(`docs: a (#5)`, branch)).toEqual([
      expect.stringContaining(`"${type}"`),
    ]);
  });

  it('rejects an issue title without the branch number at its end', () => {
    for (const title of ['chore: add the checks', 'chore: add (#2)', 'chore: add (#1) now']) {
      expect(branchTitleProblems(title, issue)).toEqual([expect.stringContaining('(#1)')]);
    }
  });

  it('asks a release branch for its fixed title', () => {
    const release = parseBranch('release/1.4.0');

    expect(branchTitleProblems('chore(release): 1.4.0', release)).toEqual([]);
    expect(branchTitleProblems('chore(release): 1.4.1', release)).toHaveLength(1);
    expect(branchTitleProblems('chore(release): 1.4.0 (#9)', release)).toHaveLength(1);
  });

  it('asks a dependency update for fix(deps) or chore(deps) without an issue number', () => {
    const renovate = parseBranch('renovate/vitest-5.x');

    expect(branchTitleProblems('fix(deps): update zod to v4.7.0', renovate)).toEqual([]);
    expect(branchTitleProblems('chore(deps): update vitest to v5.2.0', renovate)).toEqual([]);
    expect(branchTitleProblems('chore: update vitest', renovate)).toHaveLength(1);
    expect(branchTitleProblems('chore(deps): update vitest (#4)', renovate)).toHaveLength(1);
  });

  it('asks nothing more on scratch and other branches', () => {
    expect(branchTitleProblems('feat: anything', parseBranch('scratch/7-x'))).toEqual([]);
    expect(branchTitleProblems('feat: anything', parseBranch('main'))).toEqual([]);
  });
});

describe('branchMessageProblems', () => {
  it('accepts an issue commit whose last line is the Step trailer, after other trailers', () => {
    expect(branchMessageProblems(valid, issue)).toEqual([]);
  });

  it('rejects an issue commit without Step as its last line', () => {
    const trailerNotLast = 'chore: add (#1)\n\nStep: scaffold\nCo-Authored-By: a';

    expect(branchMessageProblems('chore: add (#1)', issue)).toHaveLength(1);
    expect(branchMessageProblems(trailerNotLast, issue)).toHaveLength(1);
  });

  it('rejects an unknown step', () => {
    expect(branchMessageProblems('chore: add (#1)\n\nStep: review', issue)).toEqual([
      expect.stringContaining('"review"'),
    ]);
  });

  it('rejects a Step trailer on a dependency update and asks nothing elsewhere', () => {
    const renovate = parseBranch('renovate/vitest-5.x');

    expect(branchMessageProblems('chore(deps): a\n\nStep: implement', renovate)).toHaveLength(1);
    expect(branchMessageProblems('chore(deps): a', renovate)).toEqual([]);
    expect(branchMessageProblems('feat: a', parseBranch('scratch/7-x'))).toEqual([]);
  });
});

describe('lineLengthProblems', () => {
  it('allows long lines that hold a URL and rejects other long lines', () => {
    const url = `See https://example.com/${'a'.repeat(120)}`;
    const long = 'b'.repeat(101);

    expect(lineLengthProblems(`fix: a (#1)\n\n${url}\n\nStep: implement`)).toEqual([]);
    expect(lineLengthProblems(`fix: a (#1)\n\n${long}\n\nStep: implement`)).toEqual([
      expect.stringContaining('101 characters'),
    ]);
  });
});
