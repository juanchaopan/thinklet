import { defineConfig } from 'vitest/config';

// Unit tests of the Node.js scripts in this folder. They run in Node.js, not
// in the browser like the component tests (../vitest.config.ts).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['**/*.ts'],
      exclude: ['**/*.spec.ts', 'vitest.config.ts'],
      thresholds: {
        statements: 80,
      },
    },
  },
});
