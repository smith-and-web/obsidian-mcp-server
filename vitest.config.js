import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // The database-backed suites share one Postgres and create the schema on start; run files
    // one at a time so they cannot race each other.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'tests/', 'examples/', 'bruno/'],
    },
  },
});
