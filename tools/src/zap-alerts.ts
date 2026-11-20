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

export interface JudgedAlert {
  alertRef: string;
  name: string;
  risk: string;
  count: string;
  /** Why the alert is ignored, when it is on the ignore list. */
  ignoredReason?: string;
  failing: boolean;
}

/** Medium (2) and high (3) alerts fail the scan; informational and low do not. */
const FAILING_RISK = 2;
const RISK_NAMES: Record<string, string> = {
  '0': 'Informational',
  '1': 'Low',
  '2': 'Medium',
  '3': 'High',
};
const ENTRY_KEYS = new Set(['alertRef', 'reason']);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseEntry(entry: unknown, index: number): IgnoredAlert {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`Ignored alert ${index} must be an object with alertRef and reason`);
  }
  const fields = entry as Record<string, unknown>;
  const unknownKey = Object.keys(fields).find((key) => !ENTRY_KEYS.has(key));
  if (unknownKey !== undefined) {
    throw new Error(`Ignored alert ${index} has an unknown field "${unknownKey}"`);
  }
  const { alertRef, reason } = fields;
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
 * Every alert in the report, each marked failing when it is of medium risk
 * or higher and not on the ignore list.
 */
export function judgeAlerts(report: ZapReport, ignored: IgnoredAlert[]): JudgedAlert[] {
  const reasons = new Map(ignored.map((entry) => [entry.alertRef, entry.reason]));
  return (report.site ?? [])
    .flatMap((site) => site.alerts ?? [])
    .map((alert) => {
      const ignoredReason = reasons.get(alert.alertRef);
      return {
        alertRef: alert.alertRef,
        name: alert.name,
        risk: RISK_NAMES[alert.riskcode] ?? alert.riskcode,
        count: alert.count,
        ...(ignoredReason === undefined ? {} : { ignoredReason }),
        failing: ignoredReason === undefined && Number(alert.riskcode) >= FAILING_RISK,
      };
    });
}
