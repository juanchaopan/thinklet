import { defineConfig } from 'vitest/config';

// Unit tests of the repository's own check scripts. The rules live in src/
// and are tested there; bin/ only wires them to git, files and the command
// line.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      thresholds: {
        statements: 80,
      },
    },
  },
});
