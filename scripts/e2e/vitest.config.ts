// Tests against a running local Supabase (`npx supabase start`). Not part of
// `npm test`. Run: npx vitest run --config scripts/e2e/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: `${import.meta.dirname}/../..`,
  test: {
    include: ['scripts/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
