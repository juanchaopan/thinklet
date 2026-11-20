import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { disallowedPackages, isAllowed } from './licenses.ts';

const allowed = ['MIT', 'Apache-2.0', 'ISC', 'GPL-2.0-only WITH Classpath-exception-2.0'];

describe('isAllowed', () => {
  it.each([
    'MIT',
    'MIT*',
    '(MIT OR GPL-3.0-only)',
    'GPL-3.0-only OR MIT',
    'Apache-2.0 AND MIT',
    '(MIT AND (ISC OR GPL-3.0-only))',
    'Apache-2.0+',
    'MIT or GPL-3.0-only',
    'GPL-2.0-only WITH Classpath-exception-2.0',
  ])('allows %s', (license) => {
    expect(isAllowed(license, allowed)).toBe(true);
  });

  it.each([
    'GPL-3.0-only',
    'MIT AND GPL-3.0-only',
    '(GPL-3.0-only OR LGPL-2.1-only)',
    'MIT WITH Some-exception',
    'UNKNOWN',
    'Custom: https://example.com/license',
    '(MIT',
    'MIT)',
    'MIT OR',
    'AND MIT',
    '',
  ])('refuses %j', (license) => {
    expect(isAllowed(license, allowed)).toBe(false);
  });
});

describe('disallowedPackages', () => {
  it('names each package whose license is not allowed', () => {
    expect(
      disallowedPackages(
        {
          'a@1.0.0': { licenses: 'MIT' },
          'b@2.0.0': { licenses: 'GPL-3.0-only' },
          'c@3.0.0': { licenses: ['MIT', 'BSL-1.1'] },
          'd@4.0.0': {},
        },
        allowed,
      ),
    ).toEqual(['b@2.0.0: GPL-3.0-only', 'c@3.0.0: BSL-1.1', 'd@4.0.0: UNKNOWN']);
  });

  it('keeps the repository allowlist to valid permissive SPDX ids', () => {
    const list = JSON.parse(
      readFileSync(new URL('../../license-allowlist.json', import.meta.url), 'utf8'),
    ) as unknown;

    expect(list).toEqual(expect.arrayContaining(['MIT', 'Apache-2.0', 'ISC']));
    expect(list).not.toEqual(expect.arrayContaining([expect.stringMatching(/GPL|MPL|SSPL|BUSL/)]));
  });
});
