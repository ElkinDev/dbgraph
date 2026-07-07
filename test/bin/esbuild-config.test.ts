/**
 * Unit tests for the esbuild SEA bundle config — config-as-DATA (design D4/D6/D12).
 *
 * This is the (vitest) half of Batch 2: the esbuild options are a PURE data object
 * asserted here in `npm test` with NO binary and NO bundle produced. The artifact
 * that CONSUMES this config (build-bundle.mjs) is validated by the opt-in smoke.
 *
 * Pins (spec R1 "drivers external, not inlined" + design D1):
 *   - format cjs / platform node / target node24 / bundle true (Node SEA main is CJS).
 *   - the 6 driver specifiers are `external` so their lazy import() survives.
 *   - entry is the dedicated SEA entry; outfile is build/sea/dbgraph.cjs.
 *   - define bakes process.env.DBGRAPH_BUILD_VERSION at bundle time (no disk read).
 *
 * TDD: RED (scripts/sea/esbuild-config.mjs does not exist yet) → GREEN.
 */

import { describe, it, expect } from 'vitest';
// Typed via scripts/sea/esbuild-config.d.mts (build tooling; not part of the shipped package).
import {
  SEA_EXTERNAL,
  SEA_TRANSITIVE_EXTERNAL,
  buildOptions,
  versionDefine,
} from '../../scripts/sea/esbuild-config.mjs';

// The six specifiers the binary keeps EXTERNAL (better-sqlite3 + the four network
// drivers, with mysql2's /promise subpath) — ADR-002 engine set + ADR-006 lazy/optional.
const EXPECTED_EXTERNAL = ['better-sqlite3', 'mysql2', 'mysql2/promise', 'pg', 'mssql', 'mongodb'];

describe('SEA_EXTERNAL — the external driver specifiers', () => {
  it('is exactly the six driver specifiers, in order', () => {
    expect(SEA_EXTERNAL).toStrictEqual(EXPECTED_EXTERNAL);
  });
});

describe('SEA_TRANSITIVE_EXTERNAL — transitive driver deps kept external', () => {
  it('keeps tedious external (mssql/probe.ts imports it literally; else esbuild inlines it)', () => {
    expect(SEA_TRANSITIVE_EXTERNAL).toStrictEqual(['tedious']);
  });
});

describe('versionDefine — the build-time version bake', () => {
  it('maps process.env.DBGRAPH_BUILD_VERSION to the JSON-encoded literal', () => {
    expect(versionDefine('0.0.0')).toStrictEqual({
      'process.env.DBGRAPH_BUILD_VERSION': '"0.0.0"',
    });
  });

  it('JSON-encodes an arbitrary version so esbuild substitutes a valid string literal', () => {
    expect(versionDefine('9.9.9')['process.env.DBGRAPH_BUILD_VERSION']).toBe('"9.9.9"');
  });
});

describe('buildOptions(version) — the esbuild options DATA', () => {
  const opts = buildOptions('0.0.0');

  it('targets a single CJS Node bundle (Node SEA main is CommonJS — D4)', () => {
    expect(opts.format).toBe('cjs');
    expect(opts.platform).toBe('node');
    expect(opts.bundle).toBe(true);
    expect(opts.target).toBe('node24');
  });

  it('entry is the dedicated SEA entry (D5)', () => {
    expect(opts.entryPoints).toStrictEqual(['src/bin/sea-entry.ts']);
  });

  it('emits a single outfile at build/sea/dbgraph.cjs (D8)', () => {
    expect(opts.outfile).toBe('build/sea/dbgraph.cjs');
  });

  it('marks all six drivers external so NONE is inlined (D1, spec R1)', () => {
    for (const spec of EXPECTED_EXTERNAL) {
      expect(opts.external).toContain(spec);
    }
  });

  it('also marks tedious external (mssql stack must not inline, spec R1)', () => {
    expect(opts.external).toContain('tedious');
  });

  it('bakes the version via define at bundle time (D6, no disk read)', () => {
    expect(opts.define['process.env.DBGRAPH_BUILD_VERSION']).toBe('"0.0.0"');
  });

  it('a different version bakes a different literal (define is version-parameterized)', () => {
    expect(buildOptions('9.9.9').define['process.env.DBGRAPH_BUILD_VERSION']).toBe('"9.9.9"');
  });
});
