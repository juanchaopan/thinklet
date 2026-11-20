import { describe, expect, it } from 'vitest';
import { stepProblems } from './steps.ts';

const message = (step: string) => `chore(${step}): a (#1)\n\nStep: ${step}\n`;

describe('stepProblems', () => {
  it.each([
    ['kickoff', ['.docs/brief.md', '.docs/reference/old-system/notes.md']],
    ['architect', ['.docs/architecture.md', '.docs/decisions/0001-x.md']],
    ['design', ['.docs/design/README.md', '.docs/design/home.png']],
    ['scaffold', ['apps/web/src/main.ts', 'Taskfile.yml', 'README.md']],
    ['implement', ['apps/api/src/main.ts', 'docs/notes.md']],
  ])('lets the %s step change its own files', (step, files) => {
    expect(stepProblems(message(step), files)).toEqual([]);
  });

  it.each([
    ['kickoff', '.docs/architecture.md'],
    ['kickoff', 'VERSION'],
    ['architect', '.docs/design/README.md'],
    ['architect', 'apps/web/src/main.ts'],
    ['design', '.docs/brief.md'],
    ['scaffold', '.docs/architecture.md'],
    ['implement', '.docs/design/README.md'],
  ])('stops the %s step from changing %s', (step, file) => {
    expect(stepProblems(message(step), [file])).toEqual([expect.stringContaining(file)]);
  });

  it('names only the files outside the step', () => {
    expect(stepProblems(message('design'), ['.docs/design/a.md', 'apps/x.ts'])).toEqual([
      'The design step may change only .docs/design/, not: apps/x.ts',
    ]);
  });

  it('treats a commit without a Step trailer as a code step', () => {
    expect(stepProblems('chore: a', ['apps/web/src/main.ts'])).toEqual([]);
    expect(stepProblems('chore: a', ['.docs/brief.md'])).toEqual([
      expect.stringContaining('without a "Step:" trailer'),
    ]);
  });

  it('rejects a Step trailer that names no step', () => {
    expect(stepProblems('chore: a\n\nStep: review', [])).toEqual([
      expect.stringContaining('"Step: review"'),
    ]);
  });
});
