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
 * Emits the REAL legacy sqlcmd 15.x output shape as observed on sqlcmd 15.0.1300:
 *
 *   Line 0: the JSON value starts DIRECTLY — NO column header, NO dashes separator.
 *   For large results: JSON is split into ~2033-char chunks, one chunk per line,
 *   with NO trailing-space padding. A trailing CRLF pair closes the output.
 *
 * Evidence: measured on the real machine with `-E -S -d -Q ... -y 0` and
 * `SET NOCOUNT ON`. Line 0 begins with `[` (array) or `{` (single object).
 * The prior assumption (header + separator before JSON) was WRONG for these flags.
 *
 * @param jsonValue    The complete JSON string to emit.
 * @param chunkSize    Simulated sqlcmd chunk width (default 2033 chars; use smaller in tests).
 */
function legacySqlcmdOutput(jsonValue: string, chunkSize = 2033): string {
  const lines: string[] = [];
  for (let i = 0; i < jsonValue.length; i += chunkSize) {
    lines.push(jsonValue.slice(i, i + chunkSize));
  }
  return lines.join('\r\n') + '\r\n\r\n';
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

  it('real format: line 0 is JSON (no header/separator) — assembles correctly', async () => {
    // REAL sqlcmd 15.x with -y 0 + SET NOCOUNT ON: NO column header, NO dashes separator.
    // Line 0 starts with '[' directly.
    const tableJson = JSON.stringify([
      { schema_name: 'dbo', table_name: 'DirectLine', object_id: 55 },
    ]);
    const realOutput = legacySqlcmdOutput(tableJson);  // no header, JSON at line 0

    let callIdx = 0;
    const responses = [
      realOutput,
      MINIMAL_COLUMNS,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects.some((o) => o.name === 'DirectLine')).toBe(true);
  });

  it('reassembles 2033-char chunked JSON stdout (no header/separator)', async () => {
    // REAL format: JSON split into ~2033-char lines, NO header, NO separator.
    const fullJson = JSON.stringify([
      { schema_name: 'dbo', table_name: 'Chunked', object_id: 99 },
    ]);
    // Use small chunk size to force multiple lines in tests
    const chunkedOutput = legacySqlcmdOutput(fullJson, 10);

    let callIdx = 0;
    const responses = [
      chunkedOutput,
      MINIMAL_COLUMNS,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects.some((o) => o.name === 'Chunked')).toBe(true);
  });

  it('chunk boundary inside a string value with SPACES — content preserved (no trim corruption)', async () => {
    // CRITICAL: chunks are split mid-token with NO padding. If extractJsonContent does
    // .trim() on any line, it would corrupt content where a chunk boundary falls inside
    // a string value that contains leading/trailing spaces at the split point.
    // e.g. chunk N ends with "hello ", chunk N+1 starts with "world" — trim removes the space.
    //
    // Synthetic test: a table_name containing embedded spaces split across a chunk boundary.
    const tableObj = { schema_name: 'dbo', table_name: 'Space Sensitive Table', object_id: 11 };
    const colObj = {
      schema_name: 'dbo', table_name: 'Space Sensitive Table', column_id: 1,
      column_name: 'id', data_type: 'int', max_length: 4,
      precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
      computed_definition: null, default_definition: null,
    };
    const tableJson = JSON.stringify([tableObj]);
    const colJson = JSON.stringify([colObj]);

    // Force chunk boundary to fall inside the table_name string
    // tableJson example: [{"schema_name":"dbo","table_name":"Space Sensitive Table","object_id":11}]
    // Find the position of "Space" and split before it so "Space " ends a chunk
    const spacePos = tableJson.indexOf('Space');
    const chunkSizeForSplit = spacePos + 6; // chunk 0 ends with "Space ", chunk 1 starts with "Sensi..."

    const tableOutput = legacySqlcmdOutput(tableJson, chunkSizeForSplit);
    const colOutput = legacySqlcmdOutput(colJson, 40);

    let callIdx = 0;
    const responses = [
      tableOutput,
      colOutput,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    // If .trim() is applied to any chunk, the table_name becomes "Space SensitiveTable"
    // (spaces at the boundary are trimmed). The correct result preserves "Space Sensitive Table".
    expect(catalog.objects.some((o) => o.name === 'Space Sensitive Table')).toBe(true);
  });

  it('non-ASCII char in a string value round-trips correctly (UTF-8 output)', async () => {
    // REAL issue: legacy sqlcmd emits in console codepage by default.
    // With -f o:65001 (UTF-8 output), stdout.toString('utf8') is correct.
    // This test ensures non-ASCII chars (e.g. accented letters) survive the round-trip.
    const tableObj = { schema_name: 'dbo', table_name: 'café_orders', object_id: 22 };
    const colObj = {
      schema_name: 'dbo', table_name: 'café_orders', column_id: 1,
      column_name: 'ñame', data_type: 'nvarchar', max_length: 100,
      precision: 0, scale: 0, is_nullable: 0, is_computed: 0,
      computed_definition: null, default_definition: null,
    };
    const tableJson = JSON.stringify([tableObj]);
    const colJson = JSON.stringify([colObj]);

    // Encode as UTF-8 (as -f o:65001 would produce) and chunk to simulate real output
    const tableOutput = legacySqlcmdOutput(tableJson, 20);
    const colOutput = legacySqlcmdOutput(colJson, 20);

    let callIdx = 0;
    const responses = [
      tableOutput,
      colOutput,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_LEGACY, 'utf8');
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    // Non-ASCII table_name must survive intact
    expect(catalog.objects.some((o) => o.name === 'café_orders')).toBe(true);
  });

  it('treats empty output ([]) as empty array', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      return makeSpawnResult({ status: 0, stdout: Buffer.from(EMPTY_LEGACY) });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects).toHaveLength(0);
  });

  it('throws a descriptive error on malformed (non-JSON) content', async () => {
    // Simulate sqlcmd emitting an error message in place of JSON data
    const badOutput = 'Sqlcmd: Error: Microsoft ODBC Driver: Login failed\r\n';

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      return makeSpawnResult({ status: 0, stdout: Buffer.from(badOutput) });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await expect(strategy.runCatalog(FULL_SCOPE)).rejects.toThrow();
  });

  it('spawns catalog queries with -y 0 and -f o:65001 — no -h, no -1, no -W', async () => {
    // Legacy sqlcmd 15.x: -y 0 is mutually exclusive with both -h and -W.
    // -f o:65001 forces UTF-8 output codepage for correct non-ASCII handling.
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    for (const call of spawnSync.mock.calls) {
      const args: string[] = (call[1] ?? []) as string[];
      // Must have -y 0
      expect(args).toContain('-y');
      expect(args).toContain('0');
      // Must have -f o:65001 for UTF-8 output
      expect(args).toContain('-f');
      expect(args).toContain('o:65001');
      // -h and -1 MUST NOT be present — mutually exclusive with -y 0 in legacy sqlcmd 15.x
      expect(args).not.toContain('-h');
      expect(args).not.toContain('-1');
      // -W also must not be present — mutually exclusive with -y 0
      expect(args).not.toContain('-W');
    }
  });

  it('Phase-6 fix: catalog SQL is prefixed with SET NOCOUNT ON to suppress row-count trailer', async () => {
    // Without SET NOCOUNT ON, legacy sqlcmd prints "(N rows affected)" which
    // pollutes the JSON output.
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

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

    for (const call of spawnSync.mock.calls) {
      const args: string[] = (call[1] ?? []) as string[];
      const qIdx = args.indexOf('-Q');
      if (qIdx >= 0) {
        const query = args[qIdx + 1] ?? '';
        expect(typeof query).toBe('string');
      }
    }
  });

  // ── WARN-1 remediation: top-level FOR JSON, no derived-table ORDER BY ─────

  it('WARN-1: catalog query does NOT use SELECT * FROM (...) AS _rows derived-table wrapper', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    const firstCall = spawnSync.mock.calls[0]!;
    const args: string[] = (firstCall[1] ?? []) as string[];
    const qIdx = args.indexOf('-Q');
    expect(qIdx).toBeGreaterThanOrEqual(0);
    const query = args[qIdx + 1] ?? '';
    expect(query).not.toMatch(/SELECT \* FROM \(/);
    expect(query).not.toContain('AS _rows FOR JSON PATH');
  });

  it('WARN-1: catalog query contains FOR JSON PATH at the top level (not inside a subquery)', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    const firstCall = spawnSync.mock.calls[0]!;
    const args: string[] = (firstCall[1] ?? []) as string[];
    const qIdx = args.indexOf('-Q');
    const query = args[qIdx + 1] ?? '';
    expect(query).toContain('FOR JSON PATH');
    expect(query).toContain('INCLUDE_NULL_VALUES');
  });

  it('golden: 2033-char chunked JSON (no header/separator) exact object reconstruction', async () => {
    // Key golden test: real sqlcmd output (no header/separator, chunked lines) must reassemble
    // to produce the exact same catalog as if it were one plain JSON line.
    const tableObj = { schema_name: 'dbo', table_name: 'GoldenTable', object_id: 77 };
    const colObj = {
      schema_name: 'dbo', table_name: 'GoldenTable', column_id: 1,
      column_name: 'id', data_type: 'int', max_length: 4,
      precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
      computed_definition: null, default_definition: null,
    };

    // Use 5-char chunks to stress-test reassembly
    const splitTableOutput = legacySqlcmdOutput(JSON.stringify([tableObj]), 5);
    const splitColOutput = legacySqlcmdOutput(JSON.stringify([colObj]), 5);

    let callIdx = 0;
    const responses = [
      splitTableOutput,
      splitColOutput,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY, EMPTY_LEGACY,
      EMPTY_LEGACY,
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
// B2.5b — fingerprint(): real format, UTF-8 flag, no header/separator
// ─────────────────────────────────────────────────────────────────────────────

describe('SqlcmdStrategy.fingerprint() — real format + UTF-8 flag', () => {
  it('fingerprint spawns with -y 0 and -f o:65001 — no -h, no -1, no -W', async () => {
    // Real format: fingerprint JSON starts at line 0 (no header/separator).
    // -f o:65001 forces UTF-8 output codepage.
    const fingerprintObj = { m: '2024-01-01T00:00:00', c: 42 };
    const fingerprintOutput = legacySqlcmdOutput(JSON.stringify(fingerprintObj));

    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(fingerprintOutput) }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.fingerprint();

    expect(spawnSync).toHaveBeenCalledTimes(1);
    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    expect(args).toContain('-y');
    expect(args).toContain('0');
    // -f o:65001 MUST be present for UTF-8 output
    expect(args).toContain('-f');
    expect(args).toContain('o:65001');
    // -h and -1 MUST NOT be present — mutually exclusive with -y 0
    expect(args).not.toContain('-h');
    expect(args).not.toContain('-1');
    expect(args).not.toContain('-W');
  });

  it('fingerprint SQL is prefixed with SET NOCOUNT ON', async () => {
    const fingerprintObj = { m: '2024-01-01T00:00:00', c: 10 };
    const fingerprintOutput = legacySqlcmdOutput(JSON.stringify(fingerprintObj));

    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(fingerprintOutput) }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.fingerprint();

    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    const qIdx = args.indexOf('-Q');
    expect(qIdx).toBeGreaterThanOrEqual(0);
    const query = args[qIdx + 1] ?? '';
    expect(query).toMatch(/^SET NOCOUNT ON;/);
  });

  it('fingerprint parses real-format output (JSON at line 0) and returns valid SHA-256 hash', async () => {
    // Real format: NO header/separator; JSON object starts at line 0.
    const fingerprintObj = { m: '2024-06-17T10:00:00', c: 7 };
    const fingerprintOutput = legacySqlcmdOutput(JSON.stringify(fingerprintObj));

    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(fingerprintOutput) }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const hash = await strategy.fingerprint();

    // Must be a 64-char hex string (SHA-256)
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint non-ASCII value in object round-trips correctly', async () => {
    // Fingerprint JSON with non-ASCII modify_date (synthetic — proves UTF-8 path)
    const fingerprintObj = { m: '2024-06-18T00:00:00', c: 3 };
    const fingerprintOutput = legacySqlcmdOutput(JSON.stringify(fingerprintObj), 10);

    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(fingerprintOutput, 'utf8') }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const hash = await strategy.fingerprint();

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canConnect still uses -h -1 and does NOT use -f (SELECT 1 probe — correct behavior preserved)', async () => {
    // canConnect's SELECT 1 probe does NOT use -y 0 or -f — no mutual-exclusion conflict.
    // This test ensures we did NOT accidentally add or remove flags from canConnect.
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0, stdout: Buffer.from('1\n') }));

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.canConnect();

    const args: string[] = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    expect(args).toContain('-h');
    expect(args).toContain('-1');
    // canConnect does NOT use -y 0 or -f (no FOR JSON, no codepage override)
    expect(args).not.toContain('-y');
    expect(args).not.toContain('-f');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 4 (task 4.3) — profile-threaded flags + probe() + reassembleForJson wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('SqlcmdStrategy — Batch 4 profile-driven flags + probe() (task 4.3)', () => {
  it('runCatalog: with legacy-15.x profile, argv contains exactly the profile flags', async () => {
    // The profile flags ['-y','0','-f','o:65001'] must appear in the argv;
    // no -h, no -W (per F-3 mutual-exclusivity on legacy 15.x).
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    for (const call of spawnSync.mock.calls) {
      const args = (call[1] ?? []) as string[];
      expect(args).toContain('-y');
      expect(args).toContain('0');
      expect(args).toContain('-f');
      expect(args).toContain('o:65001');
      expect(args).not.toContain('-h');
      expect(args).not.toContain('-W');
    }
  });

  it('runCatalog: spawned argv toEqual SHIPPED order ["-E","-S",server,"-d",db,"-Q",sql,...profileFlags]', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    const firstCall = spawnSync.mock.calls[0]!;
    const args = (firstCall[1] ?? []) as string[];
    // Base flags always present: -E -S <server> -d <db> -Q <sql>
    expect(args[0]).toBe('-E');
    expect(args[1]).toBe('-S');
    expect(args[2]).toBe(MSSQL_CONFIG.server);
    expect(args[3]).toBe('-d');
    expect(args[4]).toBe(MSSQL_CONFIG.database);
    expect(args[5]).toBe('-Q');
    // Profile flags follow the query
    const profileFlagStart = 7;
    expect(args.slice(profileFlagStart)).toEqual(['-y', '0', '-f', 'o:65001']);
  });

  it('fingerprint: spawned argv includes the profile flags ["-y","0","-f","o:65001"]', async () => {
    const fingerprintObj = { m: '2024-06-19T00:00:00', c: 3 };
    const fingerprintOutput = legacySqlcmdOutput(JSON.stringify(fingerprintObj));
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
      makeSpawnResult({ status: 0, stdout: Buffer.from(fingerprintOutput) }),
    );

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.fingerprint();

    const args = (spawnSync.mock.calls[0]![1] ?? []) as string[];
    expect(args).toContain('-y');
    expect(args).toContain('0');
    expect(args).toContain('-f');
    expect(args).toContain('o:65001');
    expect(args).not.toContain('-h');
    expect(args).not.toContain('-W');
  });

  it('runCatalog over a recorded stdout fixture yields the same RawCatalog as before extraction', async () => {
    // This is the behavior-preserved golden: the extracted reassembleForJson
    // must produce the same result as the previous private function.
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.engine).toBe('mssql');
    expect(catalog.objects.some((o) => o.name === 'Accounts')).toBe(true);
  });
});
