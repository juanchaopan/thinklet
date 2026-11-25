import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBranch } from './branch.ts';
import { matchesPattern, parseRiskRules, riskTier, type RiskRules } from './risk.ts';

const rules: RiskRules = {
  high: ['.github/**', '**/tsconfig*.json', '**/.env*', 'apps/api/src/infrastructure/**'],
  low: ['.docs/**', '**/*.md', 'LICENSE'],
};
const issue = parseBranch('feature/12-order-filter');

function repositoryRules(): RiskRules {
  return parseRiskRules(readFileSync(new URL('../../risk-rules.yml', import.meta.url), 'utf8'));
}

describe('parseRiskRules', () => {
  it('reads the two lists of quoted patterns, skipping comments and blank lines', () => {
    const text = [
      '# Risk rules',
      'high:',
      "  - '.github/**'",
      '  - "**/*.sql"',
      '',
      '  # infrastructure',
      "  - 'apps/api/src/infrastructure/**'",
      'low:',
      "  - '.docs/**'",
      '',
    ].join('\n');

    expect(parseRiskRules(text)).toEqual({
      high: ['.github/**', '**/*.sql', 'apps/api/src/infrastructure/**'],
      low: ['.docs/**'],
    });
  });

  it('accepts Windows line endings', () => {
    expect(parseRiskRules("high:\r\n  - 'a'\r\nlow:\r\n  - 'b'\r\n")).toEqual({
      high: ['a'],
      low: ['b'],
    });
  });

  it.each([
    ['an unquoted pattern', "high:\n  - .github/**\nlow:\n  - 'b'"],
    ['an item before any list', "  - 'a'\nhigh:\nlow:"],
    ['an unknown key', "high:\nmedium:\n  - 'a'\nlow:"],
    ['a repeated key', 'high:\nhigh:\nlow:'],
    ['mismatched quotes', 'high:\n  - \'a"\nlow:'],
  ])('rejects %s, naming the line', (_name, text) => {
    expect(() => parseRiskRules(text)).toThrow(/^Line \d+ /);
  });

  it('needs both lists', () => {
    expect(() => parseRiskRules("high:\n  - 'a'")).toThrow('both');
  });

  it('reads the repository rules file', () => {
    const { high, low } = repositoryRules();

    expect(high).toContain('risk-rules.yml');
    expect(high).toContain('license-allowlist.json');
    expect(low).toContain('.docs/**');
  });

  // The architecture's risk rules put every api module that keeps parents'
  // and children's data at high risk, and with them the data migrations
  // written in code and every Dockerfile.
  it.each([
    'apps/api/src/modules/auth/auth.controller.ts',
    'apps/api/src/modules/family/family.service.ts',
    'apps/api/src/modules/audit/audit.service.ts',
    'apps/api/src/modules/account/account.service.ts',
    'apps/api/src/modules/account/authing-webhook.controller.ts',
    'apps/web/src/app/core/auth/auth.service.ts',
    'apps/api/src/data-migrations/0001-bind-child-ciphertexts.ts',
    'apps/api/src/migrate-data.ts',
    'apps/web/component-tests.Dockerfile',
    'Dockerfile',
    'apps/api/Dockerfile.dev',
  ])('puts %s at high risk in the repository rules', (file) => {
    expect(riskTier([file], issue, repositoryRules())).toBe('high');
  });
});

describe('matchesPattern', () => {
  it.each([
    ['README.md', '**/*.md'],
    ['.docs/design/README.md', '**/*.md'],
    ['apps/web/.vscode/notes.md', '**/*.md'],
    ['.github/workflows/ci.yml', '.github/**'],
    ['.env.example', '**/.env*'],
    ['apps/web/.env', '**/.env*'],
    ['tsconfig.node.json', '**/tsconfig*.json'],
    ['apps/web/tsconfig.app.json', '**/tsconfig*.json'],
    ['eslint.config.mjs', 'eslint.config.*'],
  ])('matches %s with %s', (file, pattern) => {
    expect(matchesPattern(file, pattern)).toBe(true);
  });

  it.each([
    ['apps/LICENSE', 'LICENSE'],
    ['apps/web/src/main.ts', '**/*.md'],
    ['apps/api/src/modules/a.ts', 'apps/api/src/infrastructure/**'],
    ['docs/a.md', '.docs/**'],
  ])('does not match %s with %s', (file, pattern) => {
    expect(matchesPattern(file, pattern)).toBe(false);
  });
});

describe('riskTier', () => {
  it('is high when any file is on a high-risk path', () => {
    expect(riskTier(['README.md', '.github/workflows/ci.yml'], issue, rules)).toBe('high');
  });

  it('is high when a file is on both a high-risk and a low-risk path', () => {
    expect(riskTier(['.github/README.md'], issue, rules)).toBe('high');
  });

  it('is low when every file is on a low-risk path', () => {
    const files = ['.docs/architecture.md', 'apps/web/README.md', 'LICENSE'];

    expect(riskTier(files, issue, rules)).toBe('low');
  });

  it('is medium otherwise', () => {
    const files = ['.docs/architecture.md', 'apps/web/src/main.ts'];

    expect(riskTier(files, issue, rules)).toBe('medium');
  });

  it('is medium when nothing changed', () => {
    expect(riskTier([], issue, rules)).toBe('medium');
  });

  it('is always high on a release branch', () => {
    expect(riskTier(['.docs/brief.md'], parseBranch('release/1.2.0'), rules)).toBe('high');
  });
});
