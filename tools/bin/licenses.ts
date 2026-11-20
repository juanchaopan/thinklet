import { execFile, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { disallowedPackages, type LicensedPackage } from '../src/licenses.ts';

// The license check: every production dependency of every workspace package
// has a license from the allowlist. The workspace packages themselves are
// private and left out. The packages are checked side by side, as each check
// walks its own dependency tree.
//   --allowlist <file>  the allowed SPDX ids as a JSON array (default license-allowlist.json)

interface WorkspacePackage {
  name: string;
  path: string;
}

const { values } = parseArgs({
  options: { allowlist: { type: 'string', default: 'license-allowlist.json' } },
});
const allowed = JSON.parse(readFileSync(values.allowlist, 'utf8')) as string[];

const require = createRequire(import.meta.url);
const checker = join(
  dirname(require.resolve('license-checker-rseidelsohn/package.json')),
  'bin',
  'license-checker-rseidelsohn.js',
);

const workspacePackages = JSON.parse(
  execSync('pnpm ls --recursive --depth -1 --json', { encoding: 'utf8' }),
) as WorkspacePackage[];

async function packageProblems({ name, path }: WorkspacePackage): Promise<string[]> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [checker, '--start', path, '--production', '--excludePrivatePackages', '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const packages = JSON.parse(stdout) as Record<string, LicensedPackage>;
  return disallowedPackages(packages, allowed).map((problem) => `${name}: ${problem}`);
}

const problems = (await Promise.all(workspacePackages.map(packageProblems))).flat();

if (problems.length > 0) {
  console.error(
    [
      `Production dependencies with a license outside ${values.allowlist}:`,
      ...problems.map((problem) => `  ${problem}`),
    ].join('\n'),
  );
  process.exit(1);
}
console.log(
  `Licenses: every production dependency of ${workspacePackages.length} packages is allowed.`,
);
