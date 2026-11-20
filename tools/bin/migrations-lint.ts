import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { addedFiles } from '../src/git.ts';

// The migration check: Squawk lints only the migration scripts this branch
// adds compared with where it left the base (committed, staged or not yet
// tracked); merged scripts are never changed, so they are not checked again.
// Passes when there are none.
//   --base <ref>  default origin/main

const MIGRATIONS = 'apps/api/drizzle/*.sql';

const { values } = parseArgs({ options: { base: { type: 'string', default: 'origin/main' } } });
const files = addedFiles(process.cwd(), values.base, MIGRATIONS);
if (files.length === 0) {
  console.log(`Migrations: no new ${MIGRATIONS} since ${values.base}.`);
  process.exit(0);
}

const squawk = join(
  dirname(createRequire(import.meta.url).resolve('squawk-cli/package.json')),
  'js',
  'bin',
  'squawk',
);
const result = spawnSync(process.execPath, [squawk, ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
