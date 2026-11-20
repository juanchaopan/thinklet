import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A throwaway git repository for tests, removed by `remove()`. */
export interface TestRepository {
  dir: string;
  git: (...args: string[]) => string;
  /** Writes the files (path to content), stages them and commits with the message. */
  commit: (message: string, files: Record<string, string>) => string;
  remove: () => void;
}

const identity = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** Creates a repository whose `main` branch holds one first commit. */
export function createTestRepository(): TestRepository {
  const dir = mkdtempSync(join(tmpdir(), 'tools-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ...identity },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const write = (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
  };
  const commit = (message: string, files: Record<string, string>) => {
    write(files);
    git('add', '--all');
    git('commit', '--quiet', '--allow-empty', '--message', message);
    return git('rev-parse', 'HEAD').trim();
  };
  git('init', '--quiet', '--initial-branch', 'main');
  commit('chore: start the project\n\nStep: kickoff', { '.docs/brief.md': 'brief\n' });
  return { dir, git, commit, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
