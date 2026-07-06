import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration files use the *.integration.test.ts suffix and are excluded
    // from the default `npm test` run. They are only executed by `npm run test:integration`
    // (which targets the integration glob explicitly) and require DBGRAPH_INTEGRATION=1.
    // This ensures: (a) Docker-less contributors stay green on `npm test`, and
    // (b) ubuntu-latest in the unit CI matrix (which has Docker) does NOT
    //     accidentally start containers — the explicit env flag is the true gate.
    // Smoke files (*.smoke.test.ts, phase-9.5c) validate BUILT artifacts (esbuild
    // bundle + SEA binary) and are excluded here so `npm test` stays green with NO
    // binary built (D12 CI-independence). They run only via `npm run smoke:binary`
    // (vitest.smoke.config.ts) and self-skip when their artifact is absent.
    exclude: ['**/*.integration.test.ts', '**/*.smoke.test.ts'],
    // Native-module cold starts (better-sqlite3 first load) and temp-DB
    // materialization in hooks can exceed Vitest's 10s default on a cold
    // Windows CI runner — observed as a flaky "Hook timed out in 10000ms" on
    // test/adapters/engines/sqlite/factory.test.ts. These ceilings still catch
    // a genuine hang while giving native/IO setup honest headroom.
    // (Container-backed integration suites set their own per-suite hookTimeout >= 240s.)
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
