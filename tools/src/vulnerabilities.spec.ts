import { describe, expect, it } from 'vitest';
import { findings, type OsvReport } from './vulnerabilities.ts';

function report(maxSeverity: string | undefined, label?: string): OsvReport {
  return {
    results: [
      {
        packages: [
          {
            package: { name: 'pkg', version: '1.0.0' },
            vulnerabilities: [
              { id: 'GHSA-1', ...(label ? { database_specific: { severity: label } } : {}) },
            ],
            groups: [{ ids: ['GHSA-1'], ...(maxSeverity ? { max_severity: maxSeverity } : {}) }],
          },
        ],
      },
    ],
  };
}

describe('findings', () => {
  it.each([
    ['6.9', false],
    ['7.0', true],
    ['9.8', true],
  ])('marks a CVSS score of %s as failing: %s', (score, failing) => {
    expect(findings(report(score))).toEqual([
      { package: 'pkg@1.0.0', ids: ['GHSA-1'], severity: String(Number(score)), failing },
    ]);
  });

  it('falls back on the advisory severity label without a score', () => {
    expect(findings(report(undefined, 'high'))[0]?.failing).toBe(true);
    expect(findings(report(undefined, 'CRITICAL'))[0]?.failing).toBe(true);
    expect(findings(report(undefined, 'MODERATE'))[0]?.failing).toBe(false);
    expect(findings(report(undefined))[0]).toMatchObject({ severity: 'unknown', failing: false });
  });

  it('reports nothing for an empty report', () => {
    expect(findings({})).toEqual([]);
    expect(findings({ results: [{}] })).toEqual([]);
  });
});
