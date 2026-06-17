/**
 * tsup build configuration — task 7.1 (phase-4-cli-config).
 * Design Decision 8: two entries — library + CLI.
 *
 * Entry 1 — index (library):
 *   src/index.ts → dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts
 *   Consumers: import from '@niklerk23/dbgraph'
 *
 * Entry 2 — cli (executable):
 *   src/cli/cli.ts → dist/cli.js (ESM only, no dts)
 *   banner injects the shebang so npm exec / npx can run it directly.
 *   package.json "bin": { "dbgraph": "./dist/cli.js" }
 *
 * --clean is implicit: tsup cleans the dist/ directory between builds.
 * Both entries are built atomically (one config, one tsup invocation).
 */
import { defineConfig } from 'tsup';

export default defineConfig([
  // ── Entry 1: Library (unchanged from previous inline script) ─────────────
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: false,
  },
  // ── Entry 2: CLI executable (ESM-only, shebang injected via banner) ───────
  {
    entry: { cli: 'src/cli/cli.ts' },
    format: ['esm'],
    dts: false,
    // --clean must be false here: Entry 1 already cleaned dist/;
    // Entry 2 runs second and must NOT wipe Entry 1's output.
    clean: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    sourcemap: false,
  },
]);
