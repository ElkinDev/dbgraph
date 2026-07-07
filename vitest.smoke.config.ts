import { defineConfig } from 'vitest/config';

/**
 * Smoke (artifact-level) vitest config — phase-9.5c, design D12.
 *
 * Runs ONLY `*.smoke.test.ts` — the opt-in, LOCAL gate that validates BUILT artifacts
 * (the esbuild bundle and the SEA binary). These files are EXCLUDED from the default
 * `npm test` (see vitest.config.ts) so `npm test` stays green on a machine with NO
 * binary built (the CI-independence contract).
 *
 * Each smoke file self-gates on its OWN prerequisite and SKIPS cleanly when it is
 * absent (never fails):
 *   - bundle-external.smoke.test.ts → needs build/sea/dbgraph.cjs (`npm run bundle:sea`).
 *   - win-binary.smoke.test.ts      → needs DBGRAPH_BINARY_PATH (`npm run build:sea:win`).
 *
 * Invoked via `npm run smoke:binary`. Timeouts are generous: spawning the exe and
 * running init→sync→query against a fixture graph can take several seconds cold.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.smoke.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
