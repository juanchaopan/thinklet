import { existsSync, readFileSync } from 'node:fs';
import { isDocument, lastChangedProblems } from '../src/last-changed.ts';
import { workingFiles } from '../src/git.ts';

// The project rule for documents: every Markdown file under .docs/ ends with
// its "Last changed:" line. Checks the given files that are documents, or
// every document when none is given.

const cwd = process.cwd();
const given = process.argv.slice(2).map((path) => path.replaceAll('\\', '/'));
const documents = (given.length > 0 ? given : workingFiles(cwd, '.docs'))
  .filter(isDocument)
  .filter((path) => existsSync(path));

const problems = documents.flatMap((path) => lastChangedProblems(path, readFileSync(path, 'utf8')));
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Last changed lines: ${documents.length} documents checked.`);
