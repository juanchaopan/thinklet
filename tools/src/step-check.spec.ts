import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRange, checkStaged } from './step-check.ts';
import { createTestRepository, type TestRepository } from './test-repository.ts';

const BRANCH = 'maintenance/1-set-up';
let repository: TestRepository;

beforeEach(() => {
  repository = createTestRepository();
  repository.git('switch', '--quiet', '--create', BRANCH);
});

afterEach(() => {
  repository.remove();
});

/** Adds a commit on the branch and one on main that changes a document, then returns to the branch. */
function divergeFromMain(): void {
  repository.commit('chore(scaffold): a (#1)\n\nStep: scaffold', { 'apps/web/main.ts': 'a\n' });
  repository.git('switch', '--quiet', 'main');
  repository.commit('chore: b (#2)', { '.docs/architecture.md': 'b\n' });
  repository.git('switch', '--quiet', BRANCH);
}

describe('checkRange', () => {
  it('passes commits that change only what their step may change', () => {
    repository.commit('chore(architect): a (#1)\n\nStep: architect', {
      '.docs/architecture.md': 'a\n',
    });
    repository.commit('chore(scaffold): b (#1)\n\nStep: scaffold', { 'apps/web/main.ts': 'b\n' });

    expect(checkRange(repository.dir, 'main', 'HEAD')).toEqual([]);
  });

  it('reports each commit that changes files outside its step', () => {
    const wrong = repository.commit('chore(scaffold): a (#1)\n\nStep: scaffold', {
      '.docs/architecture.md': 'a\n',
      'apps/web/main.ts': 'a\n',
    });

    expect(checkRange(repository.dir, 'main', 'HEAD')).toEqual([
      { commit: wrong, problems: [expect.stringContaining('.docs/architecture.md')] },
    ]);
  });

  it('skips a merge that brings main in, whatever main changed', () => {
    divergeFromMain();
    repository.git('merge', '--quiet', '--no-edit', 'main');

    expect(checkRange(repository.dir, 'main', 'HEAD')).toEqual([]);
  });

  it('checks a merge of another branch by what it changes on this one', () => {
    repository.git('switch', '--quiet', '--create', 'side');
    repository.commit('chore: side', { '.docs/design/a.md': 'a\n' });
    repository.git('switch', '--quiet', BRANCH);
    repository.commit('chore(scaffold): b (#1)\n\nStep: scaffold', { 'apps/web/main.ts': 'b\n' });
    repository.git('merge', '--quiet', '--no-ff', '--message', 'chore: merge side (#1)', 'side');

    const problems = checkRange(repository.dir, 'main', 'HEAD');

    expect(problems.map((problem) => problem.problems)).toEqual([
      [expect.stringContaining('.docs/design/a.md')],
      [expect.stringContaining('.docs/design/a.md')],
    ]);
  });
});

describe('checkStaged', () => {
  it('checks the staged files against the step of the message', () => {
    writeFileSync(join(repository.dir, 'README.md'), 'readme\n');
    repository.git('add', 'README.md');

    expect(checkStaged(repository.dir, 'chore: a (#1)\n\nStep: scaffold', ['main'])).toEqual([]);
    expect(checkStaged(repository.dir, 'chore: a (#1)\n\nStep: design', ['main'])).toEqual([
      expect.stringContaining('README.md'),
    ]);
  });

  it('counts a rename as changing both paths', () => {
    repository.git('mv', '.docs/brief.md', 'brief.md');

    expect(checkStaged(repository.dir, 'chore: a (#1)\n\nStep: scaffold', ['main'])).toEqual([
      expect.stringContaining('.docs/brief.md'),
    ]);
  });

  it('does not check concluding a merge of main', () => {
    divergeFromMain();
    repository.git('merge', '--quiet', '--no-commit', '--no-ff', 'main');

    const message = `Merge branch 'main' into ${BRANCH}`;
    expect(checkStaged(repository.dir, message, ['origin/main', 'main'])).toEqual([]);
  });
});
