import { describe, expect, it } from 'vitest';
import { judgeAlerts, parseIgnoredAlerts, type ZapAlert } from './zap-alerts.ts';

function alert(alertRef: string, riskcode: string): ZapAlert {
  return { alertRef, name: `Alert ${alertRef}`, riskcode, count: '2' };
}

describe('judgeAlerts', () => {
  it.each([
    ['0', 'Informational', false],
    ['1', 'Low', false],
    ['2', 'Medium', true],
    ['3', 'High', true],
  ])('marks an alert of riskcode %s (%s) as failing: %s', (riskcode, risk, failing) => {
    expect(judgeAlerts({ site: [{ alerts: [alert('10038-1', riskcode)] }] }, [])).toEqual([
      { ...alert('10038-1', riskcode), risk, ignoredReason: undefined, failing },
    ]);
  });

  it('keeps an ignored alert in the list with its reason, without failing', () => {
    const report = { site: [{ alerts: [alert('10055-6', '2'), alert('10055-4', '2')] }] };
    expect(judgeAlerts(report, [{ alertRef: '10055-6', reason: 'Needed by the app' }])).toEqual([
      expect.objectContaining({
        alertRef: '10055-6',
        ignoredReason: 'Needed by the app',
        failing: false,
      }),
      expect.objectContaining({ alertRef: '10055-4', ignoredReason: undefined, failing: true }),
    ]);
  });

  it('collects the alerts of every site', () => {
    const report = { site: [{ alerts: [alert('1-1', '1')] }, {}, { alerts: [alert('2-1', '3')] }] };
    expect(judgeAlerts(report, []).map((judged) => judged.alertRef)).toEqual(['1-1', '2-1']);
  });

  it('shows an unknown riskcode as it is', () => {
    expect(judgeAlerts({ site: [{ alerts: [alert('1-1', '7')] }] }, [])[0]?.risk).toBe('7');
  });

  it('reports nothing for an empty report', () => {
    expect(judgeAlerts({}, [])).toEqual([]);
  });
});

describe('parseIgnoredAlerts', () => {
  it('reads entries with an alertRef and a reason', () => {
    expect(parseIgnoredAlerts([])).toEqual([]);
    expect(parseIgnoredAlerts([{ alertRef: '10055-6', reason: 'Inline styles' }])).toEqual([
      { alertRef: '10055-6', reason: 'Inline styles' },
    ]);
  });

  it.each([
    ['a value that is not an array', { alertRef: '10055-6' }, /JSON array/],
    ['an entry that is not an object', ['10055-6'], /must be an object/],
    ['an entry without alertRef', [{ reason: 'x' }], /needs an alertRef/],
    ['an entry without reason', [{ alertRef: '10055-6' }], /10055-6 needs a reason/],
    ['an entry with a blank reason', [{ alertRef: '10055-6', reason: '  ' }], /needs a reason/],
    [
      'an alertRef listed twice',
      [
        { alertRef: '1-1', reason: 'x' },
        { alertRef: '1-1', reason: 'y' },
      ],
      /more than once/,
    ],
  ])('rejects %s', (_case, value, message) => {
    expect(() => parseIgnoredAlerts(value)).toThrow(message);
  });
});
