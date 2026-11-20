/** The parts of OSV-Scanner's JSON output (`--format json`) this check reads. */
export interface OsvReport {
  results?: Array<{ packages?: OsvPackage[] }>;
}

interface OsvPackage {
  package: { name: string; version?: string };
  vulnerabilities?: Array<{ id: string; database_specific?: { severity?: string } }>;
  groups?: Array<{ ids: string[]; max_severity?: string }>;
}

export interface Finding {
  package: string;
  ids: string[];
  severity: string;
  failing: boolean;
}

/** CVSS scores from 7.0 are high (7.0 to 8.9) or critical (9.0 and above). */
const HIGH_SCORE = 7;
const HIGH_LABELS = new Set(['HIGH', 'CRITICAL']);

/**
 * Every vulnerability group OSV-Scanner reports, each marked failing when it
 * is high or critical: by its highest CVSS score, or by the advisory's own
 * severity label when no score is given.
 */
export function findings(report: OsvReport): Finding[] {
  return (report.results ?? []).flatMap((result) =>
    (result.packages ?? []).flatMap(({ package: pkg, vulnerabilities = [], groups = [] }) =>
      groups.map((group) => {
        const score = Number.parseFloat(group.max_severity ?? '');
        const labels = vulnerabilities
          .filter((vulnerability) => group.ids.includes(vulnerability.id))
          .map((vulnerability) => vulnerability.database_specific?.severity?.toUpperCase() ?? '');
        const hasScore = !Number.isNaN(score);
        return {
          package: `${pkg.name}@${pkg.version ?? '?'}`,
          ids: group.ids,
          severity: hasScore ? String(score) : labels.join(', ') || 'unknown',
          failing: hasScore ? score >= HIGH_SCORE : labels.some((label) => HIGH_LABELS.has(label)),
        };
      }),
    ),
  );
}
