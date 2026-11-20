/** The parts of a ZAP JSON report (`zap-baseline.py -J`) this check reads. */
export interface ZapReport {
  site?: Array<{ alerts?: ZapAlert[] }>;
}

export interface ZapAlert {
  alertRef: string;
  name: string;
  riskcode: string;
  count: string;
}

/**
 * One alert the scan does not fail on, named by ZAP's alertRef (the plugin
 * id plus the variant, such as `10055-6`) so that ignoring it hides no other
 * problem the same plugin finds.
 */
export interface IgnoredAlert {
  alertRef: string;
  reason: string;
}

export interface JudgedAlert extends ZapAlert {
  /**
   * The risk's name; for an unknown riskcode the riskcode itself, or
   * `Unknown` when the report gives none.
   */
  risk: string;
  /** Why the alert is ignored, when it is on the ignore list. */
  ignoredReason: string | undefined;
  failing: boolean;
}

/**
 * ZAP's riskcodes. Medium (2) and high (3) alerts fail the scan;
 * informational and low do not. A Map, so that no riskcode read from the
 * report can match an inherited object property.
 */
const RISKS = new Map<unknown, { name: string; failing: boolean }>([
  ['0', { name: 'Informational', failing: false }],
  ['1', { name: 'Low', failing: false }],
  ['2', { name: 'Medium', failing: true }],
  ['3', { name: 'High', failing: true }],
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseEntry(entry: unknown, index: number): IgnoredAlert {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`Ignored alert ${index} must be an object with alertRef and reason`);
  }
  const { alertRef, reason } = entry as Record<string, unknown>;
  if (!nonEmptyString(alertRef)) {
    throw new Error(`Ignored alert ${index} needs an alertRef, such as "10055-6"`);
  }
  if (!nonEmptyString(reason)) {
    throw new Error(`Ignored alert ${alertRef} needs a reason why it needs no fix`);
  }
  return { alertRef, reason };
}

/**
 * Reads the ignore list: an array of `{ "alertRef", "reason" }` entries, each
 * with a non-empty reason, no alertRef twice. Throws on anything else, so a
 * mistake in the list never silently ignores or keeps an alert.
 */
export function parseIgnoredAlerts(value: unknown): IgnoredAlert[] {
  if (!Array.isArray(value)) {
    throw new Error('The ignored alerts must be a JSON array');
  }
  const entries = value.map((entry: unknown, index) => parseEntry(entry, index));
  const seen = new Set<string>();
  for (const { alertRef } of entries) {
    if (seen.has(alertRef)) {
      throw new Error(`Ignored alert ${alertRef} is listed more than once`);
    }
    seen.add(alertRef);
  }
  return entries;
}

/**
 * Every alert in the report, each marked failing when it is not on the
 * ignore list and its risk is medium or higher. An alert whose riskcode is
 * missing or not one ZAP defines fails as well, so a report the check cannot
 * read never passes the scan.
 */
export function judgeAlerts(report: ZapReport, ignored: IgnoredAlert[]): JudgedAlert[] {
  const reasons = new Map(ignored.map((entry) => [entry.alertRef, entry.reason]));
  return (report.site ?? [])
    .flatMap((site) => site.alerts ?? [])
    .map((alert) => {
      const ignoredReason = reasons.get(alert.alertRef);
      const known = RISKS.get(alert.riskcode);
      return {
        ...alert,
        risk: known?.name ?? (nonEmptyString(alert.riskcode) ? alert.riskcode : 'Unknown'),
        ignoredReason,
        failing: ignoredReason === undefined && (known?.failing ?? true),
      };
    });
}
