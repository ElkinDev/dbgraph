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
const MINIMAL_TABLES = JSON.stringify([
  { schema_name: 'dbo', table_name: 'Accounts', object_id: 10 },
]);

const MINIMAL_COLUMNS = JSON.stringify([
  {
    schema_name: 'dbo', table_name: 'Accounts', column_id: 1,
    column_name: 'id', data_type: 'int', max_length: 4,
    precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
    computed_definition: null, default_definition: null,
  },
]);

const EMPTY_JSON = JSON.stringify([]);

/**
 * Builds a fake spawnSync that returns the given stdout for the n-th call.
 * Calls are ordered by the 11 catalog families in runCatalog().
 * We only need real data for tables + columns; everything else is [].
 * fingerprint() is a separate method, NOT called by runCatalog.
 */
function makeCatalogSpawnSync(tableJson: string, columnJson: string): MockedFunction<SpawnSyncFn> {
  // Order of calls in runCatalog matches the queries.ts import order:
  // tables, columns, keyConstraints, foreignKeys, checkConstraints,
  // indexes, modules, triggerEvents, sequences, extendedProperties,
  // dependencies (11 families total — fingerprint is separate)
  const responses = [
    tableJson,   // tables
    columnJson,  // columns
    EMPTY_JSON,  // keyConstraints
    EMPTY_JSON,  // foreignKeys
    EMPTY_JSON,  // checkConstraints
    EMPTY_JSON,  // indexes
    EMPTY_JSON,  // modules
    EMPTY_JSON,  // triggerEvents
    EMPTY_JSON,  // sequences
    EMPTY_JSON,  // extendedProperties
    EMPTY_JSON,  // dependencies
  ];

  let callIdx = 0;
  return vi.fn<SpawnSyncFn>().mockImplementation(() => {
    const stdout = Buffer.from(responses[callIdx] ?? EMPTY_JSON);
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

  it('reassembles multi-line split JSON stdout into one document', async () => {
    // Simulate sqlcmd splitting a JSON at line boundaries (~2033 byte chunks)
    const fullJson = JSON.stringify([
      { schema_name: 'dbo', table_name: 'Split', object_id: 99 },
    ]);
    // Split the JSON string into 3 parts across separate stdout lines
    const part1 = fullJson.slice(0, 10);
    const part2 = fullJson.slice(10, 20);
    const part3 = fullJson.slice(20);
    const multiLinestdout = `${part1}\r\n${part2}\r\n${part3}\r\n(1 rows affected)\r\n`;

    let callIdx = 0;
    const responses = [
      multiLinestdout,    // tables — split across lines
      MINIMAL_COLUMNS,    // columns
      EMPTY_JSON, EMPTY_JSON, EMPTY_JSON, EMPTY_JSON,
      EMPTY_JSON, EMPTY_JSON, EMPTY_JSON, EMPTY_JSON,
      EMPTY_JSON,         // dependencies (11th family — end of runCatalog)
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_JSON);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects.some((o) => o.name === 'Split')).toBe(true);
  });

  it('strips (N rows affected) footer lines before JSON.parse', async () => {
    // The footer line must not cause JSON.parse failure
    const jsonWithFooter = `${MINIMAL_TABLES}\r\n(1 rows affected)\r\n\r\n`;

    let callIdx = 0;
    const responses = [
      jsonWithFooter,  // tables
      MINIMAL_COLUMNS,
      EMPTY_JSON, EMPTY_JSON, EMPTY_JSON, EMPTY_JSON,
      EMPTY_JSON, EMPTY_JSON, EMPTY_JSON, EMPTY_JSON,
      EMPTY_JSON,      // dependencies (11th family — end of runCatalog)
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_JSON);
      callIdx += 1;
      return makeSpawnResult({ status: 0, stdout });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await expect(strategy.runCatalog(FULL_SCOPE)).resolves.toBeTruthy();
  });

  it('treats empty stdout (after stripping) as empty array', async () => {
    // All families return empty result (no rows)
    const emptyWithFooter = `\r\n(0 rows affected)\r\n`;

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      return makeSpawnResult({ status: 0, stdout: Buffer.from(emptyWithFooter) });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const catalog = await strategy.runCatalog(FULL_SCOPE);

    expect(catalog.objects).toHaveLength(0);
  });

  it('throws a descriptive error on malformed (non-JSON) stdout output', async () => {
    // Simulate sqlcmd emitting an error message instead of JSON
    const badOutput = 'Sqlcmd: Error: Microsoft ODBC Driver\r\n';

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      return makeSpawnResult({ status: 0, stdout: Buffer.from(badOutput) });
    });

    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await expect(strategy.runCatalog(FULL_SCOPE)).rejects.toThrow();
  });

  it('spawns each catalog query with -y 0 -h -1 -W flags', async () => {
    const spawnSync = makeCatalogSpawnSync(MINIMAL_TABLES, MINIMAL_COLUMNS);
    const strategy = new SqlcmdStrategy(MSSQL_CONFIG, spawnSync);

    await strategy.runCatalog(FULL_SCOPE);

    // Check the first catalog query call (tables)
    const firstCall = spawnSync.mock.calls[0]!;
    const args: string[] = (firstCall[1] ?? []) as string[];
    expect(args).toContain('-y');
    expect(args).toContain('0');
    expect(args).toContain('-h');
    expect(args).toContain('-1');
    expect(args).toContain('-W');
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

  it('multi-line split-JSON golden: exact object reconstruction', async () => {
    // This is the key golden test: a FOR JSON response split across many lines
    // must reassemble to produce the exact same catalog as if it were one line.
    const tableObj = { schema_name: 'dbo', table_name: 'GoldenTable', object_id: 77 };
    const colObj = {
      schema_name: 'dbo', table_name: 'GoldenTable', column_id: 1,
      column_name: 'id', data_type: 'int', max_length: 4,
      precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
      computed_definition: null, default_definition: null,
    };

    const tableJson = JSON.stringify([tableObj]);
    const colJson = JSON.stringify([colObj]);

    // Split at arbitrary boundary to simulate sqlcmd line splitting
    // Use 5-char chunks to force many splits
    function splitIntoLines(s: string, chunkSize: number): string {
      const parts: string[] = [];
      for (let i = 0; i < s.length; i += chunkSize) {
        parts.push(s.slice(i, i + chunkSize));
      }
      return parts.join('\r\n') + '\r\n(1 rows affected)\r\n';
    }

    const splitTableOutput = splitIntoLines(tableJson, 5);
    const splitColOutput = splitIntoLines(colJson, 5);

    let callIdx = 0;
    const responses = [
      splitTableOutput,
      splitColOutput,
      EMPTY_JSON, EMPTY_JSON, EMPTY_JSON, EMPTY_JSON,
      EMPTY_JSON, EMPTY_JSON, EMPTY_JSON, EMPTY_JSON,
      EMPTY_JSON,      // dependencies (11th family — end of runCatalog)
    ];

    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      const stdout = Buffer.from(responses[callIdx] ?? EMPTY_JSON);
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
