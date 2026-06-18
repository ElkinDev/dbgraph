/**
 * manual-dump.test.ts — unit tests for ManualDumpStrategy.
 *
 * D4.2:
 *   - detect() returns available:true when the configured dump file exists/readable
 *   - detect() returns available:false when the file is missing
 *   - canConnect() returns true when the dump file is present and parseable
 *   - canConnect() returns false when the dump file is missing
 *   - runCatalog() reads the combined JSON, validates via json-rows, calls buildMssqlRawCatalog
 *   - runCatalog() golden: the recorded anonymized combined JSON dump → byte-identical RawCatalog (ADR-008)
 *   - runCatalog() throws on malformed JSON
 *   - runCatalog() throws on JSON that fails row validation (wrong shape)
 *   - ManualDumpStrategy.id === 'manual-dump'
 *   - close() is a no-op (no async resource to clean)
 *
 * Spec mssql-extraction "manual-dump strategy ingests one combined JSON offline".
 * connectivity-strategies Batch D, task D4.2.
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManualDumpStrategy } from '../../../../../src/adapters/engines/mssql/strategies/manual-dump.strategy.js';
import type { ExtractionScope } from '../../../../../src/core/model/capability.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Golden fixture: the recorded anonymized combined JSON dump
const GOLDEN_PATH = resolve(__dirname, '../../../../fixtures/mssql/dumps/mssql-dump-golden.json');
// A path that does not exist (used for "file missing" tests)
const MISSING_PATH = resolve(__dirname, '../../../../fixtures/mssql/dumps/__nonexistent__.json');

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'full',
    functions: 'full',
    triggers: 'full',
    sequences: 'full',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

// Base config for a manual-dump run (no live credentials — offline path)
const MSSQL_CONFIG = {
  server: 'offline-server',
  database: 'synthetic-db',
  authentication: { type: 'integrated' as const },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — injectable fs seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ReadFileFn type compatible with the ManualDumpStrategy fs seam.
 * Allows tests to inject a mock that returns controlled content.
 */
type ReadFileFn = (path: string, encoding: 'utf-8') => string;

function makeReadFileFn(content: string): ReadFileFn {
  return () => content;
}

// ─────────────────────────────────────────────────────────────────────────────
// id
// ─────────────────────────────────────────────────────────────────────────────

describe('ManualDumpStrategy — id', () => {
  it('has id "manual-dump"', () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    expect(strategy.id).toBe('manual-dump');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detect()
// ─────────────────────────────────────────────────────────────────────────────

describe('ManualDumpStrategy.detect()', () => {
  it('returns { available: true } when the dump file exists', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const result = await strategy.detect();
    expect(result.available).toBe(true);
  });

  it('returns { available: false } when the dump file does not exist', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, MISSING_PATH);
    const result = await strategy.detect();
    expect(result.available).toBe(false);
  });

  it('includes a detail message when unavailable', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, MISSING_PATH);
    const result = await strategy.detect();
    expect(result.available).toBe(false);
    expect(result.detail).toBeTruthy();
    expect(result.detail).toContain(MISSING_PATH);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canConnect()
// ─────────────────────────────────────────────────────────────────────────────

describe('ManualDumpStrategy.canConnect()', () => {
  it('returns true when the dump file is present and parseable JSON', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const result = await strategy.canConnect();
    expect(result).toBe(true);
  });

  it('returns false when the dump file is missing', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, MISSING_PATH);
    const result = await strategy.canConnect();
    expect(result).toBe(false);
  });

  it('returns false when the file exists but contains invalid JSON', async () => {
    const brokenJson = 'not-json-at-all';
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH, makeReadFileFn(brokenJson));
    const result = await strategy.canConnect();
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runCatalog() — golden (byte-identical on re-run, ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('ManualDumpStrategy.runCatalog() — golden (D4.2)', () => {
  it('produces a RawCatalog whose JSON is byte-identical on re-run (ADR-008)', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const run1 = await strategy.runCatalog(FULL_SCOPE);
    const run2 = await strategy.runCatalog(FULL_SCOPE);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it('returns engine: "mssql"', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const catalog = await strategy.runCatalog(FULL_SCOPE);
    expect(catalog.engine).toBe('mssql');
  });

  it('extracts the exact tables from the golden fixture (L-009: assert WHICH objects)', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const catalog = await strategy.runCatalog(FULL_SCOPE);
    const tableObjects = catalog.objects.filter((o) => o.kind === 'table');
    const tableQnames = tableObjects.map((o) => `${o.schema}.${o.name}`).sort();
    expect(tableQnames).toEqual(['app.accounts', 'app.sessions']);
  });

  it('extracts the view from the golden fixture (L-009)', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const catalog = await strategy.runCatalog(FULL_SCOPE);
    const viewObjects = catalog.objects.filter((o) => o.kind === 'view');
    const viewQnames = viewObjects.map((o) => `${o.schema}.${o.name}`).sort();
    expect(viewQnames).toEqual(['app.v_active_sessions']);
  });

  it('extracts the sequence from the golden fixture (L-009)', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const catalog = await strategy.runCatalog(FULL_SCOPE);
    const seqObjects = catalog.objects.filter((o) => o.kind === 'sequence');
    const seqQnames = seqObjects.map((o) => `${o.schema}.${o.name}`).sort();
    expect(seqQnames).toEqual(['app.seq_account_id']);
  });

  it('extracts the FK constraint from the golden fixture (L-009)', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const catalog = await strategy.runCatalog(FULL_SCOPE);
    const sessions = catalog.objects.find((o) => o.kind === 'table' && o.name === 'sessions');
    expect(sessions).toBeDefined();
    const fkNames = sessions?.constraints?.filter((c) => c.type === 'FK').map((c) => c.name) ?? [];
    expect(fkNames).toEqual(['FK_sessions_accounts']);
  });

  it('ingested columns match the golden fixture (coercion: bit 0/1 → boolean)', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const catalog = await strategy.runCatalog(FULL_SCOPE);
    const accounts = catalog.objects.find((o) => o.kind === 'table' && o.name === 'accounts');
    expect(accounts).toBeDefined();
    const emailCol = accounts?.columns?.find((c) => c.name === 'email');
    expect(emailCol).toBeDefined();
    // is_nullable: 1 in JSON → coerced to true
    expect(emailCol?.nullable).toBe(true);
    const idCol = accounts?.columns?.find((c) => c.name === 'account_id');
    expect(idCol).toBeDefined();
    // is_nullable: 0 in JSON → coerced to false
    expect(idCol?.nullable).toBe(false);
  });

  it('the pinned RawCatalog JSON snapshot matches the fixture byte-for-byte', async () => {
    // Build the expected catalog using the same fixture data directly via buildMssqlRawCatalog
    // to confirm the manual-dump path is byte-identical to the direct map.ts path.
    const { buildMssqlRawCatalog } = await import('../../../../../src/adapters/engines/mssql/map.js');
    const { parseJsonRows } = await import('../../../../../src/adapters/engines/mssql/strategies/json-rows.js');
    const raw = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'));
    const rowInput = parseJsonRows(raw as unknown as Parameters<typeof parseJsonRows>[0]);
    const expected = buildMssqlRawCatalog(rowInput, FULL_SCOPE);

    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    const actual = await strategy.runCatalog(FULL_SCOPE);

    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runCatalog() — error cases
// ─────────────────────────────────────────────────────────────────────────────

describe('ManualDumpStrategy.runCatalog() — error cases', () => {
  it('throws when the dump file contains invalid JSON', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH, makeReadFileFn('not-json'));
    await expect(strategy.runCatalog(FULL_SCOPE)).rejects.toThrow();
  });

  it('throws when the dump JSON is missing required family keys', async () => {
    const incomplete = JSON.stringify({ tables: [] }); // missing all other families
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH, makeReadFileFn(incomplete));
    await expect(strategy.runCatalog(FULL_SCOPE)).rejects.toThrow();
  });

  it('throws when a row fails validation (wrong type on required field)', async () => {
    const badRows = JSON.stringify({
      tables: [{ schema_name: 123, table_name: 'foo', object_id: 1 }], // schema_name must be string
      columns: [], keyConstraints: [], foreignKeys: [], checkConstraints: [],
      indexes: [], modules: [], triggerEvents: [], sequences: [],
      extendedProperties: [], dependencies: [],
    });
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH, makeReadFileFn(badRows));
    await expect(strategy.runCatalog(FULL_SCOPE)).rejects.toThrow(/json-rows/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// close()
// ─────────────────────────────────────────────────────────────────────────────

describe('ManualDumpStrategy.close()', () => {
  it('resolves without error (no-op)', async () => {
    const strategy = new ManualDumpStrategy(MSSQL_CONFIG, GOLDEN_PATH);
    await expect(strategy.close?.()).resolves.toBeUndefined();
  });
});
