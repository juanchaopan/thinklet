import { defineConfig } from 'vitest/config';

// One project per test subject, each run on its own command
// (`vitest run --project <name>`). Integration, security and migration tests
// live under test/<subject>/ and start their own throwaway containers with
// Testcontainers, so they get longer timeouts.
const CONTAINER_SUBJECTS = ['integration', 'security', 'migration'];
const containerTimeouts = { testTimeout: 60_000, hookTimeout: 180_000 };

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Wiring, entry points and the database layer are covered by the
      // integration tests, and the data migrations by the migration tests,
      // not by unit tests.
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.module.ts',
        'src/**/*.controller.ts',
        'src/**/*.repository.ts',
        'src/main.ts',
        'src/server.ts',
        'src/rebuild.ts',
        'src/migrate-data.ts',
        'src/data-migrations/**',
        'src/create-app.ts',
        'src/infrastructure/database/schema.ts',
      ],
      thresholds: {
        statements: 80,
      },
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      ...CONTAINER_SUBJECTS.map((name) => ({
        extends: true,
        test: { name, include: [`test/${name}/**/*.spec.ts`], ...containerTimeouts },
      })),
    ],
  },
});
