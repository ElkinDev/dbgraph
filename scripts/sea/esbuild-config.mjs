/**
 * esbuild-config — the SEA bundle options as pure DATA (design D4/D6/D8, phase-9.5c).
 *
 * This module is CONFIG-AS-DATA: it exports the esbuild options object and the pieces
 * that compose it, so `npm test` can assert the contract (externals, format, version
 * bake) with NO bundle produced (D12 CI-independence). `build-bundle.mjs` imports
 * `buildOptions(version)` and hands it straight to `esbuild.build(...)`.
 *
 * Key decisions encoded here:
 *   - D4: one CJS bundle (Node SEA's `main` is executed as CommonJS; an ESM main is
 *     not supported). platform:node + target:node24 (the pinned build Node, Batch 0).
 *   - D1: the 5 DB drivers + better-sqlite3 are `external` so their lazy, optional
 *     dynamic import() survives — NONE is inlined (ADR-006 lazy/optional preserved).
 *     node:* builtins (incl. node:sqlite) are auto-external on platform:node.
 *   - D6: `process.env.DBGRAPH_BUILD_VERSION` is replaced at bundle time with the
 *     package.json version literal via `define` — the binary answers `--version`
 *     with NO disk read, deterministically (ADR-008).
 */

/**
 * The external driver specifiers (ADR-002 five engines + better-sqlite3, with mysql2's
 * `/promise` subpath). Marked `external` so esbuild leaves their `import()` as runtime
 * dynamic imports instead of inlining the module bodies.
 * @type {readonly string[]}
 */
export const SEA_EXTERNAL = ['better-sqlite3', 'mysql2', 'mysql2/promise', 'pg', 'mssql', 'mongodb'];

/**
 * Transitive driver specifiers that must ALSO stay external. `tedious` is mssql's
 * underlying pure-JS TDS driver; `mssql/probe.ts` does a LITERAL `import('tedious')`
 * (the doctor/self-test seam, intentionally NOT routed through loadOptionalDriver).
 * Because a literal specifier that is not marked external gets INLINED by esbuild,
 * omitting `tedious` pulls the entire tedious package body into the bundle (~180
 * internal refs), violating spec R1's "NONE of them may be inlined" for the mssql
 * driver stack. Keeping it external preserves the lazy/optional model (ADR-006) and a
 * lean, deterministic bundle. Kept SEPARATE from SEA_EXTERNAL so SEA_EXTERNAL stays the
 * documented 6 driver families while `external` is the required superset (design D1).
 * @type {readonly string[]}
 */
export const SEA_TRANSITIVE_EXTERNAL = ['tedious'];

/**
 * Builds the esbuild `define` map that bakes the version at bundle time.
 * The value is JSON-encoded so esbuild substitutes a valid string literal into the
 * bundle (design D6). Off-SEA the env var is undefined → cli.ts falls back to
 * DBGRAPH_VERSION.
 *
 * @param {string} version - the package.json version (e.g. '0.0.0').
 * @returns {{ 'process.env.DBGRAPH_BUILD_VERSION': string }}
 */
export function versionDefine(version) {
  return { 'process.env.DBGRAPH_BUILD_VERSION': JSON.stringify(version) };
}

/**
 * Returns the complete esbuild options object for the SEA bundle.
 *
 * @param {string} version - the package.json version baked via `define` (D6).
 * @returns {import('esbuild').BuildOptions & { define: Record<string, string> }}
 */
export function buildOptions(version) {
  return {
    entryPoints: ['src/bin/sea-entry.ts'],
    outfile: 'build/sea/dbgraph.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: [...SEA_EXTERNAL, ...SEA_TRANSITIVE_EXTERNAL],
    define: versionDefine(version),
    // Determinism (ADR-008): no minification, no sourcemap, no legal-comment scan —
    // the same source + same pinned Node yields byte-identical output.
    minify: false,
    sourcemap: false,
    legalComments: 'none',
  };
}
