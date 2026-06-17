/**
 * Vitest config for integration tests only.
 * Used by `npm run test:integration`.
 * Does NOT exclude *.integration.test.ts (that is the whole point).
 * Container-backed suites set their own per-suite hookTimeout >= 240s.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    // Suites override this with 240_000 on their container beforeAll hook.
    // This global sets the fallback for afterAll and non-container hooks.
    hookTimeout: 300_000,
  },
});
