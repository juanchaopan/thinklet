import { spawnSync } from 'node:child_process';
import { findings, type OsvReport } from '../src/vulnerabilities.ts';

// The dependency vulnerability check: OSV-Scanner reads pnpm-lock.yaml in
// its pinned container image (OSV_SCANNER_IMAGE, set by the Taskfile) and
// the check fails on a high or critical vulnerability only; the others are
// listed.

const image = process.env['OSV_SCANNER_IMAGE'];
if (!image) {
  console.error('Set OSV_SCANNER_IMAGE to the OSV-Scanner image (the Taskfile sets it).');
  process.exit(2);
}

const scan = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--mount',
    `type=bind,src=${process.cwd()},dst=/src,readonly`,
    image,
    'scan',
    'source',
    '--format',
    'json',
    '--lockfile',
    '/src/pnpm-lock.yaml',
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
);
// OSV-Scanner exits with 0 when it finds nothing and 1 when it finds
// vulnerabilities; any other code is an error of the scan itself.
if (scan.status !== 0 && scan.status !== 1) {
  console.error(`OSV-Scanner failed (exit code ${String(scan.status)}).`);
  process.exit(1);
}

const found = findings(JSON.parse(scan.stdout) as OsvReport);
for (const finding of found) {
  const level = finding.failing ? 'HIGH ' : 'other';
  console.log(
    `${level} ${finding.package} ${finding.ids.join(', ')} (severity ${finding.severity})`,
  );
}
const failing = found.filter((finding) => finding.failing).length;
if (failing > 0) {
  console.error(`${failing} high or critical vulnerabilities.`);
  process.exit(1);
}
console.log(`No high or critical vulnerabilities (${found.length} lower ones listed above).`);
