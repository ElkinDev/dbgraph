/**
 * bundle-external smoke — proves the emitted SEA bundle keeps the DB drivers EXTERNAL
 * and inlines NONE of their module bodies (spec R1, design D1). ARTIFACT-level: it
 * scans build/sea/dbgraph.cjs and is EXCLUDED from `npm test` (D12) — run via
 * `npm run smoke:binary`. SKIPS cleanly when the bundle has not been built.
 *
 * Two assertions per driver:
 *   1. presence — the specifier survives as an external dynamic reference
 *      (`import("<pkg>")`, or the `loadOptionalDriver("mssql")` seam for the variable
 *      specifier that never becomes a literal import).
 *   2. absence — a driver-INTERNAL marker string is absent, so the module BODY is not
 *      inlined. Each marker was verified to exist in the package but appear in neither
 *      the bundle nor dbgraph's own source (a package-exclusive inlining detector).
 *
 * `tedious` is mssql's underlying TDS driver, imported literally by mssql/probe.ts; it
 * must stay external too or its ~180 internal refs inline (see esbuild-config.mjs).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, '..', '..', 'build', 'sea', 'dbgraph.cjs');
const bundleBuilt = existsSync(bundlePath);
const bundle = bundleBuilt ? readFileSync(bundlePath, 'utf-8') : '';

/** A driver-internal marker string that MUST be absent (proves body not inlined). */
const INTERNAL_MARKERS: ReadonlyArray<readonly [driver: string, marker: string]> = [
  ['better-sqlite3', 'better_sqlite3.node'],
  ['pg', 'pg-connection-string'],
  ['mysql2', 'PoolCluster'],
  ['mssql', 'msnodesqlv8'],
  ['mongodb', 'BSONError'],
  ['tedious', 'TDS_VERSION'],
];

/** Drivers whose specifier survives as a literal external `import("<pkg>")`. */
const EXTERNAL_IMPORTS = ['better-sqlite3', 'pg', 'mysql2', 'mongodb', 'tedious'];

describe.skipIf(!bundleBuilt)('SEA bundle keeps drivers external, not inlined (spec R1)', () => {
  it('the bundle was found for scanning', () => {
    expect(bundle.length).toBeGreaterThan(0);
  });

  for (const [driver, marker] of INTERNAL_MARKERS) {
    it(`does NOT inline the ${driver} module body (marker "${marker}" absent)`, () => {
      expect(bundle.includes(marker)).toBe(false);
    });
  }

  for (const pkg of EXTERNAL_IMPORTS) {
    it(`references ${pkg} only as an external dynamic import("${pkg}")`, () => {
      expect(bundle.includes(`import("${pkg}")`)).toBe(true);
    });
  }

  it('references mssql via the loadOptionalDriver seam (variable specifier stays runtime)', () => {
    expect(bundle.includes('loadOptionalDriver("mssql")')).toBe(true);
  });

  it('contains no esbuild inlined-module wrapper for any driver (require_<driver> absent)', () => {
    for (const wrapper of ['require_tedious', 'require_pg', 'require_mongodb', 'require_mysql2']) {
      expect(bundle.includes(wrapper)).toBe(false);
    }
  });
});
