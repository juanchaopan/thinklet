import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addedFiles,
  changedFiles,
  commitFiles,
  commitsBetween,
  currentBranch,
  isAncestor,
  mergeHead,
  workingFiles,
} from './git.ts';
import { createTestRepository, type TestRepository } from './test-repository.ts';

let repository: TestRepository;

beforeEach(() => {
  repository = createTestRepository();
});

afterEach(() => {
  vi.unstubAllEnvs();
  repository.remove();
});

describe('currentBranch', () => {
  it('prefers the pull request head branch, then the checked-out branch', () => {
    vi.stubEnv('GITHUB_HEAD_REF', '');
    expect(currentBranch(repository.dir)).toBe('main');

    vi.stubEnv('GITHUB_HEAD_REF', 'feature/12-x');
    expect(currentBranch(repository.dir)).toBe('feature/12-x');
  });

  it('is empty on a detached HEAD and outside a repository', () => {
    vi.stubEnv('GITHUB_HEAD_REF', '');
    repository.git('switch', '--quiet', '--detach');
    expect(currentBranch(repository.dir)).toBe('');
    expect(currentBranch(join(repository.dir, 'missing'))).toBe('');
  });
});

describe('history', () => {
  it('lists the commits of a range oldest first with their files', () => {
    repository.git('switch', '--quiet', '--create', 'feature/12-x');
    const first = repository.commit('feat: a (#12)', { 'a.ts': 'a\n' });
    const second = repository.commit('feat: b (#12)', { 'b.ts': 'b\n', 'dir/c.ts': 'c\n' });

    const commits = commitsBetween(repository.dir, 'main', 'HEAD');

    expect(commits).toEqual([
      { sha: first, parents: [expect.any(String)] },
      { sha: second, parents: [first] },
    ]);
    expect(commitFiles(repository.dir, { sha: second, parents: [first] })).toEqual([
      'b.ts',
      'dir/c.ts',
    ]);
    expect(changedFiles(repository.dir, 'main')).toEqual(['a.ts', 'b.ts', 'dir/c.ts']);
  });

  it('lists every file of a root commit', () => {
    const root = repository.git('rev-list', '--max-parents=0', 'HEAD').trim();

    expect(commitFiles(repository.dir, { sha: root, parents: [] })).toEqual(['.docs/brief.md']);
  });

  it('tells whether one commit is an ancestor of another', () => {
    repository.git('switch', '--quiet', '--create', 'feature/12-x');
    repository.commit('feat: a (#12)', { 'a.ts': 'a\n' });

    expect(isAncestor(repository.dir, 'main', 'HEAD')).toBe(true);
    expect(isAncestor(repository.dir, 'HEAD', 'main')).toBe(false);
    expect(isAncestor(repository.dir, 'no-such-ref', 'HEAD')).toBe(false);
  });
});

describe('working tree', () => {
  it('finds files added since main, committed, staged or untracked', () => {
    repository.git('switch', '--quiet', '--create', 'feature/12-x');
    repository.commit('feat: a (#12)', { 'db/0001_a.sql': 'select 1;\n', 'db/old.txt': 'x\n' });
    writeFileSync(join(repository.dir, 'db', '0002_b.sql'), 'select 2;\n');
    repository.git('add', 'db/0002_b.sql');
    writeFileSync(join(repository.dir, 'db', '0003_c.sql'), 'select 3;\n');

    expect(addedFiles(repository.dir, 'main', 'db/*.sql').sort()).toEqual([
      'db/0001_a.sql',
      'db/0002_b.sql',
      'db/0003_c.sql',
    ]);
    expect(workingFiles(repository.dir, 'db').sort()).toEqual([
      'db/0001_a.sql',
      'db/0002_b.sql',
      'db/0003_c.sql',
      'db/old.txt',
    ]);
  });

  it('knows whether a merge is in progress', () => {
    expect(mergeHead(repository.dir)).toBeUndefined();

    repository.git('switch', '--quiet', '--create', 'side');
    const side = repository.commit('feat: side', { 'side.ts': 's\n' });
    repository.git('switch', '--quiet', 'main');
    repository.commit('feat: main', { 'main.ts': 'm\n' });
    repository.git('merge', '--quiet', '--no-commit', 'side');

    expect(mergeHead(repository.dir)).toBe(side);
  });
});
