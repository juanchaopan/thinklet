const ISSUE_LINE = /^Last changed: #\d+ \((\d{4}-\d{2}-\d{2})\)$/;
const INITIAL_LINE = /^Last changed: initial commit \((\d{4}-\d{2}-\d{2})\)$/;

/** The project brief, the one document written before any issue exists. */
const BRIEF = '.docs/brief.md';

/** Whether a repository-relative path is a document the rule applies to. */
export function isDocument(path: string): boolean {
  return path.startsWith('.docs/') && path.endsWith('.md');
}

function lastLine(content: string): string {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }
  return lines.at(-1) ?? '';
}

/** The date of the document's "Last changed:" line, if the line has an allowed form. */
function lastChangedDate(path: string, line: string): string | undefined {
  const forms = path === BRIEF ? [ISSUE_LINE, INITIAL_LINE] : [ISSUE_LINE];
  return forms.map((form) => form.exec(line)?.[1]).find((date) => date !== undefined);
}

function isCalendarDate(text: string): boolean {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

/**
 * Problems of a document under .docs/ with the project rule: its last line
 * is `Last changed: #<number> (<YYYY-MM-DD>)`; the brief may instead end
 * with `Last changed: initial commit (<YYYY-MM-DD>)`.
 */
export function lastChangedProblems(path: string, content: string): string[] {
  const line = lastLine(content);
  const date = lastChangedDate(path, line);
  if (date === undefined) {
    const forms =
      path === BRIEF
        ? '"Last changed: #<number> (<YYYY-MM-DD>)" or "Last changed: initial commit (<YYYY-MM-DD>)"'
        : '"Last changed: #<number> (<YYYY-MM-DD>)"';
    return [`${path}: the last line must be ${forms}, not "${line}".`];
  }
  return isCalendarDate(date) ? [] : [`${path}: ${date} is not a date.`];
}
