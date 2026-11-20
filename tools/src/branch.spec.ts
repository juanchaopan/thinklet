import { describe, expect, it } from 'vitest';
import { parseBranch } from './branch.ts';

describe('parseBranch', () => {
  it.each([
    ['feature/12-order-filter', 'feature', '12'],
    ['fix/3-login', 'fix', '3'],
    ['refactor/40-split-orders', 'refactor', '40'],
    ['maintenance/1-set-up-the-project', 'maintenance', '1'],
  ])('reads %s as an issue branch', (name, issueType, issueNumber) => {
    expect(parseBranch(name)).toEqual({ kind: 'issue', issueType, issueNumber });
  });

  it('reads scratch, release and dependency update branches', () => {
    expect(parseBranch('scratch/7-prototype')).toEqual({ kind: 'scratch' });
    expect(parseBranch('release/1.4.0')).toEqual({ kind: 'release', version: '1.4.0' });
    expect(parseBranch('renovate/vitest-5.x')).toEqual({ kind: 'dependencies' });
  });

  it.each(['main', '', 'feature/order-filter', 'feature/12', 'ops/5-rotate-keys', 'release/'])(
    'reads %j as another branch',
    (name) => {
      expect(parseBranch(name)).toEqual({ kind: 'other' });
    },
  );
});
