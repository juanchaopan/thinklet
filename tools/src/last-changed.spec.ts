import { describe, expect, it } from 'vitest';
import { isDocument, lastChangedProblems } from './last-changed.ts';

describe('isDocument', () => {
  it('applies to Markdown files under .docs/ only', () => {
    expect(isDocument('.docs/architecture.md')).toBe(true);
    expect(isDocument('.docs/design/screens/home.md')).toBe(true);
    expect(isDocument('.docs/design/home.png')).toBe(false);
    expect(isDocument('README.md')).toBe(false);
  });
});

describe('lastChangedProblems', () => {
  it('accepts a document ending with the issue line, with or without a final newline', () => {
    const withNewline = '# A\n\nText.\n\nLast changed: #12 (2026-11-20)\n';
    const withoutNewline = '# A\r\n\r\nLast changed: #1 (2026-02-28)';

    expect(lastChangedProblems('.docs/a.md', withNewline)).toEqual([]);
    expect(lastChangedProblems('.docs/a.md', withoutNewline)).toEqual([]);
  });

  it('accepts the initial-commit line in the brief only', () => {
    const content = '# Brief\n\nLast changed: initial commit (2026-11-17)\n';

    expect(lastChangedProblems('.docs/brief.md', content)).toEqual([]);
    expect(lastChangedProblems('.docs/architecture.md', content)).toEqual([
      expect.stringContaining('the last line must be'),
    ]);
  });

  it.each([
    ['no such line', '# A\n\nText.\n'],
    ['the line not last', '# A\n\nLast changed: #1 (2026-11-20)\n\nMore.\n'],
    ['no issue number', '# A\n\nLast changed: 2026-11-20\n'],
    ['a short date', '# A\n\nLast changed: #1 (2026-1-2)\n'],
    ['extra words', '# A\n\nLast changed: #1 (2026-11-20) by me\n'],
  ])('rejects a document with %s', (_name, content) => {
    expect(lastChangedProblems('.docs/a.md', content)).toEqual([
      expect.stringContaining('.docs/a.md: the last line must be'),
    ]);
  });

  it('rejects a date that does not exist', () => {
    expect(lastChangedProblems('.docs/a.md', 'Last changed: #1 (2026-02-30)\n')).toEqual([
      '.docs/a.md: 2026-02-30 is not a date.',
    ]);
  });
});
