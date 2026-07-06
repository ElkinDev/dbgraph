/**
 * tsup build configuration — task 7.1 (phase-4-cli-config).
 * Design Decision 8: three entries — library + CLI + MCP stdio server.
 *
 * Entry 1 — index (library):
 *   src/index.ts → dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts
 *   Consumers: import from '@niklerk23/dbgraph'
 *
 * Entry 2 — cli (executable):
 *   src/cli/cli.ts → dist/cli.js (ESM only, no dts)
 *   package.json "bin": { "dbgraph": "./dist/cli.js" }
 *
 * Entry 3 — mcp (executable):
 *   src/mcp/server.ts → dist/mcp.js (ESM only, no dts)
 *   package.json "bin": { "dbgraph-mcp": "./dist/mcp.js" }
 *
 * SHEBANG POLICY — the shebang for both executables comes from the SOURCE file
 * (`#!/usr/bin/env node` on line 1 of src/cli/cli.ts and src/mcp/server.ts).
 * esbuild PRESERVES the entry-point shebang verbatim, so no banner is needed —
 * the same mechanism the SEA bundle relies on for src/bin/sea-entry.ts.
 * A `banner: { js: '#!/usr/bin/env node' }` was previously ALSO set here; because
 * esbuild already preserves the source shebang, the banner produced a SECOND
 * `#!/usr/bin/env node` on line 2 — which Node does NOT strip, so `node dist/cli.js`
 * died with a SyntaxError. Do NOT reintroduce the banner, and do NOT remove the
 * shebang from the source entries — the source shebang is the single source of truth.
 *
 * --clean is set only on Entry 1 (runs first). Entries 2 and 3 keep clean:false so
 * they do not wipe earlier output; all three build in one tsup invocation.
 */
import { defineConfig } from 'tsup';

export default defineConfig([
  // ── Entry 1: Library (ESM + CJS + .d.ts) ─────────────────────────────────
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // `dts` is an OBJECT (not `true`) purely to scope compilerOptions to the DTS build.
    // WHY ignoreDeprecations: tsup FORCES `baseUrl: compilerOptions.baseUrl || '.'` into
    // the DTS build's compiler options (node_modules/tsup/dist/rollup.js) even though our
    // tsconfig.json declares NO baseUrl. Under TypeScript 6.0, baseUrl is deprecated and
    // TS emits TS5101; the DTS build runs with noEmitOnError, so that deprecation ABORTS
    // `tsup` (non-zero exit). Scoping the ignore HERE — not in tsconfig.json — keeps the
    // deprecation signal ALIVE for `tsc --noEmit`/IDE: if a real baseUrl is ever added to
    // tsconfig.json, tsc still flags it. This flag only pardons tsup's own unavoidable,
    // synthetic baseUrl injection during declaration emit.
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    clean: true,
    sourcemap: false,
  },
  // ── Entry 2: CLI executable (ESM-only; shebang preserved from source) ─────
  {
    entry: { cli: 'src/cli/cli.ts' },
    format: ['esm'],
    dts: false,
    // clean: false — Entry 1 already cleaned dist/; this entry must NOT wipe it.
    clean: false,
    sourcemap: false,
  },
  // ── Entry 3: MCP stdio server (ESM-only; shebang preserved from source) ───
  // Design Decision 8 (phase-5-mcp-server): third entry for the `dbgraph-mcp` bin.
  {
    entry: { mcp: 'src/mcp/server.ts' },
    format: ['esm'],
    dts: false,
    // clean: false — Entries 1 and 2 already own dist/; this entry must NOT wipe them.
    clean: false,
    sourcemap: false,
  },
]);
