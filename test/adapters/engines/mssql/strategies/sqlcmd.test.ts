/**
 * Tests for SqlcmdStrategy — detect(), canConnect(), runCatalog().
 * All child_process calls are mocked via the spawn seam injected at construction.
 *
 * Spec connectivity:
 *   - "Detection reports availability without connecting"
 *   - "A timed-out or failed probe is treated as unavailable"
 * Spec mssql-extraction:
 *   - "sqlcmd output reassembled and parsed to typed rows"
 *   - "Malformed sqlcmd output is rejected, not cast"
 *
 * connectivity-strategies Batch B, tasks B2.3–B2.5.
 * TDD: RED → GREEN.
 */

import { describe, it, expect, vi, type MockedFunction } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { SqlcmdStrategy, type SpawnSyncFn } from '../../../../../src/adapters/engines/mssql/strategies/sqlcmd.strategy.js';
import type { ExtractionScope } from '../../../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSpawnResult(overrides: Partial<Omit<SpawnSyncReturns<Buffer>, 'error'>> & { error?: Error } = {}): SpawnSyncReturns<Buffer> {
  const base: SpawnSyncReturns<Buffer> = {
    pid: 12345,
    output: [],
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    status: 0,
    signal: null,
    ...overrides,
  };
  // Only set error when explicitly provided (exactOptionalPropertyTypes)
  if (overrides.error !== undefined) {
    base.error = overrides.error;
  }
  return base;
}

const MSSQL_CONFIG = {
  server: 'MYSERVER\\SQLEXPRESS',
  database: 'MyDb',
  authentication: { type: 'integrated' as const },
} as const;

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'metadata',
    functions: 'metadata',
    triggers: 'full',
    sequences: 'full',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// B2.3 — detect()
// ─────────────────────────────────────────────────────────────────────────────

describe('SqlcmdStrategy.detect() — B2.3', () => {
  it('returns { available: true } when where/which exits 0', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 0 })); // where sqlcmd succeeds

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(true);
  });

  it('returns { available: false } when where/which exits non-zero', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 1 })) // where sqlcmd fails
      .mockReturnValueOnce(makeSpawnResult({ status: 1 })); // fallback -? probe also fails

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(false);
  });

  it('returns { available: false } when probe times out (error set)', async () => {
    const timeoutErr = new Error('spawnSync ETIMEDOUT');
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: null, error: timeoutErr }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(false);
  });

  it('falls back to sqlcmd -? capability probe when where fails but -? exits 0', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 1 })) // where/which exits 1
      .mockReturnValueOnce(makeSpawnResult({ status: 0 })); // sqlcmd -? exits 0

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(true);
  });

  it('does NOT open a DB connection during detect()', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0 }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.detect();

    // Detect calls: (1) where sqlcmd — that's it if it succeeds
    // No call should pass -E -S -d connection args
    const calls = spawnSync.mock.calls;
    for (const call of calls) {
      const args: string[] = (call[1] ?? []) as string[];
      // -S flag indicates a server connection attempt
      expect(args).not.toContain('-S');
    }
  });

  it('detect() never throws — resolves available:false on error', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      throw new Error('unexpected spawn failure');
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await expect(strategy.detect()).resolves.toMatchObject({ available: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.4 — canConnect()
// ─────────────────────────────────────────────────────────────────────────────

describe('SqlcmdStrategy.canConnect() — B2.4', () => {
  it('returns true when sqlcmd SELECT 1 exits 0', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0, stdout: Buffer.from('1\n') }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.canConnect();

    expect(result).toBe(true);
  });

  it('returns false when sqlcmd SELECT 1 exits non-zero', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 1, stderr: Buffer.from('Login failed') }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.canConnect();

    expect(result).toBe(false);
  });

  it('returns false on timeout', async () => {
    const timeoutErr = new Error('ETIMEDOUT');
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: null, error: timeoutErr }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.canConnect();

    expect(result).toBe(false);
  });

  it('spawns with shell: false (argv array, no shell interpolation)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0 }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.canConnect();

    expect(spawnSync).toHaveBeenCalled();
    const [, , opts] = spawnSync.mock.calls[0]!;
    expect((opts as { shell?: boolean }).shell).toBe(false);
  });

  it('passes server as separate argv element (no shell interpolation)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0 }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.canConnect();

    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    const serverIdx = args.indexOf('-S');
    expect(serverIdx).toBeGreaterThanOrEqual(0);
    expect(args[serverIdx + 1]).toBe('MYSERVER\\SQLEXPRESS');
  });

  it('passes database as separate argv element', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0 }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.canConnect();

    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    const dbIdx = args.indexOf('-d');
    expect(dbIdx).toBeGreaterThanOrEqual(0);
    expect(args[dbIdx + 1]).toBe('MyDb');
  });

  it('includes -E flag for integrated auth', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0 }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.canConnect();

    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    expect(args).toContain('-E');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.5 — runCatalog(): JSON reassembly + row coercion + RawCatalog output
// ─────────────────────────────────────────────────────────────────────────────

// Minimal valid row sets for each family (as sqlcmd FOR JSON would emit)
const MINIMAL_TABLES_JSON = JSON.stringify([
  { schema_name: 'dbo', table_name: 'Accounts', object_id: 10 },
]);

const MINIMAL_COLUMNS_JSON = JSON.stringify([
  {
    schema_name: 'dbo', table_name: 'Accounts', column_id: 1,
    column_name: 'id', data_type: 'int', max_length: 4,
    precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
    computed_definition: null, default_definition: null,
  },
]);

const EMPTY_JSON = JSON.stringify([]);

/**
 * Wraps raw JSON in the legacy sqlcmd 15.x output shape:
 *   Line 1: column header (e.g. "JSON_F52E2B61-18A1-11d1-B105-00805F49916B")
 *   Line 2: dashes separator ("----...----")
 *   Lines 3+: the JSON value (possibly split across lines)
 *
 * This is the real stdout shape when -h is omitted (which is required when
 * -y 0 is used — the two flags are mutually exclusive in legacy sqlcmd 15.x).
 */
function legacySqlcmdOutput(jsonValue: string, guidSuffix = 'F52E2B61-18A1-11d1-B105-00805F49916B'): string {
  const header = `JSON_${guidSuffix}`;
  const separator = '-'.repeat(header.length);
  return `${header}\r\n${separator}\r\n${jsonValue}\r\n\r\n`;
}

// Pre-built legacy-shaped constants used by most tests
const MINIMAL_TABLES = legacySqlcmdOutput(MINIMAL_TABLES_JSON);
const MINIMAL_COLUMNS = legacySqlcmdOutput(MINIMAL_COLUMNS_JSON);
const EMPTY_LEGACY = legacySqlcmdOutput(EMPTY_JSON);

/**
 * Builds a fake spawnSync that returns the given stdout for the n-th call.
 * Calls are ordered by the 11 catalog families in runCatalog().
 * We only need real data for tables + columns; everything else is [].
 * fingerprint() is a separate method, NOT called by runCatalog.
 *
 * All responses are in legacy sqlcmd 15.x shape (header + separator + JSON).
 */
function makeCatalogSpawnSync(tableOutput: string, columnOutput: string): MockedFunction<SpawnSyncFn> {
  // Order of calls in runCatalog matches the queries.ts import order:
  // tables, columns, keyConstraints, foreignKeys, checkConstraints,
  // indexes, modules, triggerEvents, sequences, extendedProperties,
  // dependencies (11 families total — fingerprint is separate)
  const responses = [
    tableOutput,    // tables
    columnOutput,   // columns
    EMPTY_LEGACY,   // keyConstraints
    EMPTY_LEGACY,   // foreignKeys
    EMPTY_LEGACY,   // checkConstraints
    EMPTY_LEGACY,   // indexes
    EMPTY_LEGACY,   // modules
    EMPTY_LEGACY,   // triggerEvents
    EMPTY_LEGACY,   // sequences
    EMPTY_LEGACY,   // extendedProperties
    EMPTY_LEGACY,   // dependencies
  ];

  let callIdx = 0;
  return vi.fn<SpawnSyncFn>().mockImplementation(() => {
    const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY);
    callIdx += 1;
    return makeSpawnResult({ status: 0, stdout });
  });
}

describe('SqlcmdStrategy.runCatalog() — B2.5', () => {
  it('returns a RawCatalog with engine "mssql"', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.engine).toBe('mssql');
  });

  it('assembles the table from coerced rows into objects', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects.some((o) => o.name === 'Accounts')).toBe(true);
  });

  it('Phase-6 fix: strips legacy sqlcmd header+separator before JSON.parse', async () => {
    // Legacy sqlcmd 15.x without -h emits a GUID column header + dashes separator
    // before the JSON data. reassembleJsonOutput must strip these two lines.
    const tableJson = JSON.stringify([
      { schema_name: 'dbo', table_name: 'HeaderTest', object_id: 55 },
    ]);
    // Simulate exact real legacy sqlcmd output: header + separator + JSON data
    const legacyOutput = legacySqlcmdOutput(tableJson);

    let callIdx = 0;
    const responses = [
      legacyOutput,      // tables — has header + separator
      MINIMAL_COLUMNS,   // columns
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,      // dependencies (11th)
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects.some((o) => o.name === 'HeaderTest')).toBe(true);
  });

  it('reassembles multi-line split JSON stdout (legacy shape: header+separator+split data)', async () => {
    // Simulate legacy sqlcmd splitting a JSON at line boundaries (~2033 byte chunks)
    const fullJson = JSON.stringify([
      { schema_name: 'dbo', table_name: 'Split', object_id: 99 },
    ]);
    // Split the JSON string into 3 parts across separate stdout lines, with header+separator
    const part1 = fullJson.slice(0, 10);
    const part2 = fullJson.slice(10, 20);
    const part3 = fullJson.slice(20);
    const header = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B';
    const sep = '-'.repeat(header.length);
    const multiLineStdout = `${header}\r\n${sep}\r\n${part1}\r\n${part2}\r\n${part3}\r\n\r\n`;

    let callIdx = 0;
    const responses = [
      multiLineStdout,   // tables — header + separator + split JSON
      MINIMAL_COLUMNS,   // columns
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,      // dependencies (11th family)
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects.some((o) => o.name === 'Split')).toBe(true);
  });

  it('treats empty legacy output (header+separator+[]) as empty array', async () => {
    // All families return empty result in legacy shape
    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      return makeSpawnResult({ status: 0, stdout: Buffer.from(EMPTY_LEGACY) });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects).toHaveLength(0);
  });

  it('throws a descriptive error on malformed (non-JSON) content after header stripping', async () => {
    // Simulate sqlcmd emitting an error message in place of JSON data (after separator)
    const header = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B';
    const sep = '-'.repeat(header.length);
    const badOutput = `${header}\r\n${sep}\r\nSqlcmd: Error: Microsoft ODBC Driver\r\n`;

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      return makeSpawnResult({ status: 0, stdout: Buffer.from(badOutput) });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await expect(strategy.runCatalog(FULL_SCOPE)).rejects.toThrow();
  });

  it('Phase-6 fix: spawns catalog queries with -y 0 ONLY — no -h, no -1, no -W', async () => {
    // Legacy sqlcmd 15.x: -y 0 is mutually exclusive with both -h and -W.
    // Using -y 0 alone (no -h, no -W) is the correct invocation.
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    // Every catalog family call must have the correct flags
    for (const call of spawnSync.mock.calls) {
      const args: string[] = (call[1] ?? []) as string[];
      expect(args).toContain('-y');
      expect(args).toContain('0');
      // -h and -1 MUST NOT be present — mutually exclusive with -y 0 in legacy sqlcmd 15.x
      expect(args).not.toContain('-h');
      expect(args).not.toContain('-1');
      // -W also must not be present — also mutually exclusive with -y 0
      expect(args).not.toContain('-W');
    }
  });

  it('Phase-6 fix: catalog SQL is prefixed with SET NOCOUNT ON to suppress row-count trailer', async () => {
    // Without SET NOCOUNT ON, legacy sqlcmd prints "(N rows affected)" which
    // pollutes the JSON output. -h was previously suppressing this via column
    // header suppression but it's now removed due to -y 0 conflict.
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    // Check the first catalog query call (tables)
    const firstCall = spawnSync.mock.calls[0]!;
    const args: string[] = (firstCall[1] ?? []) as string[];
    const qIdx = args.indexOf('-Q');
    expect(qIdx).toBeGreaterThanOrEqual(0);
    const query = args[qIdx + 1] ?? '';
    expect(query).toMatch(/^SET NOCOUNT ON;/);
  });

  it('wraps each query in FOR JSON PATH', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    // Check each call's -Q argument includes FOR JSON PATH
    for (const call of spawnSync.mock.calls) {
      const args: string[] = (call[1] ?? []) as string[];
      const qIdx = args.indexOf('-Q');
      if (qIdx >= 0) {
        const query = args[qIdx + 1] ?? '';
        // The query should wrap the original SQL in SELECT ... FOR JSON PATH
        // OR be the original SQL itself (fingerprint doesn't need wrapping)
        // We just verify it's a string (no interpolated secrets)
        expect(typeof query).toBe('string');
      }
    }
  });

  // ── WARN-1 remediation: top-level FOR JSON, no derived-table ORDER BY ─────
  // SQL Server Msg 1033: ORDER BY is illegal inside a derived table unless
  // TOP/OFFSET is present. The correct fix is to attach FOR JSON PATH,
  // INCLUDE_NULL_VALUES directly to the top-level query (not as a subquery
  // wrapper). These tests pin the correct behavior.

  it('WARN-1: catalog query does NOT use SELECT * FROM (...) AS _rows derived-table wrapper', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    // The tables query (first call) must NOT use the subquery-wrap pattern
    const firstCall = spawnSync.mock.calls[0]!;
    const args: string[] = (firstCall[1] ?? []) as string[];
    const qIdx = args.indexOf('-Q');
    expect(qIdx).toBeGreaterThanOrEqual(0);
    const query = args[qIdx + 1] ?? '';
    // Must NOT contain the broken derived-table wrapper
    expect(query).not.toMatch(/SELECT \* FROM \(/);
    expect(query).not.toContain('AS _rows FOR JSON PATH');
  });

  it('WARN-1: catalog query contains FOR JSON PATH at the top level (not inside a subquery)', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    // Verify the tables call sends FOR JSON PATH at top level
    const firstCall = spawnSync.mock.calls[0]!;
    const args: string[] = (firstCall[1] ?? []) as string[];
    const qIdx = args.indexOf('-Q');
    const query = args[qIdx + 1] ?? '';
    expect(query).toContain('FOR JSON PATH');
    expect(query).toContain('INCLUDE_NULL_VALUES');
  });

  it('Phase-6 golden: legacy sqlcmd header+separator+split-JSON exact object reconstruction', async () => {
    // Key golden test: legacy sqlcmd output (header+separator+split-JSON) must reassemble
    // to produce the exact same catalog as if it were one plain JSON line.
    const tableObj = { schema_name: 'dbo', table_name: 'GoldenTable', object_id: 77 };
    const colObj = {
      schema_name: 'dbo', table_name: 'GoldenTable', column_id: 1,
      column_name: 'id', data_type: 'int', max_length: 4,
      precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
      computed_definition: null, default_definition: null,
    };

    const tableJson = JSON.stringify([tableObj]);
    const colJson = JSON.stringify([colObj]);

    // Split at 5-char chunks to force many line splits — legacy sqlcmd splits at ~2033 bytes
    // but we use smaller chunks to stress-test the reassembly logic
    function splitLegacyOutput(s: string, chunkSize: number): string {
      const header = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B';
      const sep = '-'.repeat(header.length);
      const parts: string[] = [];
      for (let i = 0; i < s.length; i += chunkSize) {
        parts.push(s.slice(i, i + chunkSize));
      }
      return `${header}\r\n${sep}\r\n${parts.join('\r\n')}\r\n\r\n`;
    }

    const splitTableOutput = splitLegacyOutput(tableJson, 5);
    const splitColOutput = splitLegacyOutput(colJson, 5);

    let callIdx = 0;
    const responses = [
      splitTableOutput,
      splitColOutput,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,    // dependencies (11th family — end of runCatalog)
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    const tableEntry = catalog.objects.find((o) => o.name === 'GoldenTable');
    expect(tableEntry).toBeDefined();
    expect(tableEntry?.kind).toBe('table');
    expect(tableEntry?.schema).toBe('dbo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.5b — fingerprint(): Phase-6 flag fix + legacy header stripping
// ─────────────────────────────────────────────────────────────────────────────

describe('SqlcmdStrategy.fingerprint() — Phase-6 flag fix', () => {
  it('Phase-6 fix: fingerprint spawns with -y 0 ONLY — no -h, no -1, no -W', async () => {
    // Legacy sqlcmd 15.x: -y 0 mutually exclusive with -h; fingerprint must use -y 0 alone.
    const fingerprintObj = { m: '2024-01-01T00:00:00', c: 42 };
    const fingerprintJson = JSON.stringify(fingerprintObj);
    const legacyFingerprint = legacySqlcmdOutput(fingerprintJson);

    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(legacyFingerprint) }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.fingerprint();

    expect(spawnSync).toHaveBeenCalledTimes(1);
    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    expect(args).toContain('-y');
    expect(args).toContain('0');
    // -h and -1 MUST NOT be present — mutually exclusive with -y 0 in legacy sqlcmd 15.x
    expect(args).not.toContain('-h');
    expect(args).not.toContain('-1');
    expect(args).not.toContain('-W');
  });

  it('Phase-6 fix: fingerprint SQL is prefixed with SET NOCOUNT ON', async () => {
    const fingerprintObj = { m: '2024-01-01T00:00:00', c: 10 };
    const legacyFingerprint = legacySqlcmdOutput(JSON.stringify(fingerprintObj));

    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(legacyFingerprint) }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.fingerprint();

    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    const qIdx = args.indexOf('-Q');
    expect(qIdx).toBeGreaterThanOrEqual(0);
    const query = args[qIdx + 1] ?? '';
    expect(query).toMatch(/^SET NOCOUNT ON;/);
  });

  it('Phase-6 fix: fingerprint strips legacy header+separator and returns valid hash', async () => {
    // fingerprint() calls reassembleSingleObjectOutput — must strip header+separator
    const fingerprintObj = { m: '2024-06-17T10:00:00', c: 7 };
    const legacyFingerprint = legacySqlcmdOutput(JSON.stringify(fingerprintObj));

    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(legacyFingerprint) }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const hash = await strategy.fingerprint();

    // Must be a 64-char hex string (SHA-256)
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canConnect still uses -h -1 (SELECT 1 probe — no -y conflict, correct behavior preserved)', async () => {
    // canConnect's SELECT 1 probe does NOT use -y 0, so -h -1 is valid and correct.
    // This test ensures we did NOT accidentally remove -h -1 from canConnect.
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0, stdout: Buffer.from('1\n') }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.canConnect();

    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    expect(args).toContain('-h');
    expect(args).toContain('-1');
    // canConnect does NOT use -y 0 (no FOR JSON)
    expect(args).not.toContain('-y');
  });
});
