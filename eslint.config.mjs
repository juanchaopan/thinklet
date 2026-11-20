import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// One configuration for the whole repository (`task lint`). Every TypeScript
// file is linted with type information from the tsconfig that includes it;
// a TypeScript file outside every tsconfig is an error, so each one stays
// type-checked too.

// Complexity and length limits for all code.
const limits = {
  complexity: ['error', 10],
  'max-depth': ['error', 3],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-params': ['error', 4],
};

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/out-tsc/',
    '**/tmp/',
    '**/coverage/',
    '**/.angular/',
    '**/.vercel/',
    'test-results/',
    'playwright-report/',
    'blob-report/',
  ]),

  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: limits,
  },

  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...limits,
      'max-params': 'off',
      '@typescript-eslint/max-params': ['error', { max: 4 }],
      // `Array<...>` stays allowed for element types that are not a plain name.
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      // Index signatures such as process.env are read with brackets, which
      // the web app's noPropertyAccessFromIndexSignature requires.
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
      // `() => resolve()` and `() => console.error(error)` read as callbacks.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Angular components and NestJS modules are classes that only carry a
      // decorator.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // NestJS and Node.js declare plain option objects as classes, so object
      // literals passed to them are the intended use.
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      // An empty variable counts as unset, so `||` falls back on it too.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } },
      ],
      // Numbers in messages are readable as they are.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  {
    files: ['**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      // A spec file's describe callback holds all of its tests.
      'max-lines-per-function': 'off',
      // Stubs and never-settling promises are empty functions.
      '@typescript-eslint/no-empty-function': 'off',
      // Teardown guards values that a failed setup leaves unset, which their
      // declared types cannot show.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Vitest's asymmetric matchers (expect.any, expect.stringMatching) are
      // typed as any.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    files: ['apps/web/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.createProcessor(),
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
    },
  },

  {
    // Component templates, both in .html files and inline in components.
    files: ['apps/web/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },
);
