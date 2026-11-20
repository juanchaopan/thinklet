import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startEnvironment } from '../support/environment.ts';

// `task test-security-scan`: runs the ZAP baseline scan (spider plus passive
// scan) against a throwaway environment and fails when ZAP reports a
// high-risk alert. Medium and lower alerts are listed but do not fail.
// The reports are written to test-results/zap/.

const image = process.env['ZAP_IMAGE'];
if (!image) {
  throw new Error('Set ZAP_IMAGE to the pinned ZAP image (the task sets it)');
}
const reportDirectory = fileURLToPath(new URL('../../test-results/zap/', import.meta.url));
const HIGH_RISK = '3';
const RISK_NAMES: Record<string, string> = {
  '0': 'Informational',
  '1': 'Low',
  '2': 'Medium',
  '3': 'High',
};

interface ZapAlert {
  name: string;
  riskcode: string;
  count: string;
}
interface ZapReport {
  site: Array<{ alerts: ZapAlert[] }>;
}

await rm(reportDirectory, { recursive: true, force: true });
await mkdir(reportDirectory, { recursive: true });
// ZAP runs as its own user inside the container and must write the reports.
await chmod(reportDirectory, 0o777);

// The container reaches the web server through the host, so it listens on
// every interface for the length of the scan.
const environment = await startEnvironment({ webHost: '0.0.0.0' });
const container = `thinklet-zap-${randomUUID()}`;
const removeContainer = () =>
  spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
const stopOnSignal = () => {
  removeContainer();
  void environment.stop().then(() => process.exit(130));
};
process.once('SIGINT', stopOnSignal);
process.once('SIGTERM', stopOnSignal);

let scanExitCode: number | null;
try {
  const target = `http://host.docker.internal:${new URL(environment.baseUrl).port}`;
  const zap = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      container,
      '--add-host',
      'host.docker.internal:host-gateway',
      '--mount',
      `type=bind,source=${reportDirectory},target=/zap/wrk`,
      image,
      'zap-baseline.py',
      '-t',
      target,
      '-J',
      'report.json',
      '-r',
      'report.html',
      // Warnings are judged below by risk, not by ZAP's exit code.
      '-I',
    ],
    { stdio: 'inherit' },
  );
  [scanExitCode] = (await once(zap, 'exit')) as [number | null];
} finally {
  removeContainer();
  await environment.stop();
}

if (scanExitCode !== 0) {
  console.error(`ZAP did not finish the scan (exit code ${scanExitCode})`);
  process.exit(1);
}
const report = JSON.parse(await readFile(`${reportDirectory}report.json`, 'utf8')) as ZapReport;
const alerts = report.site.flatMap((site) => site.alerts);
for (const alert of alerts) {
  console.log(`[${RISK_NAMES[alert.riskcode] ?? alert.riskcode}] ${alert.name} (${alert.count})`);
}
const highRisk = alerts.filter((alert) => alert.riskcode === HIGH_RISK);
if (highRisk.length > 0) {
  console.error(
    `ZAP found ${highRisk.length} high-risk alert(s); see test-results/zap/report.html`,
  );
  process.exit(1);
}
console.log(`ZAP found no high-risk alerts (${alerts.length} alert(s) in total)`);
