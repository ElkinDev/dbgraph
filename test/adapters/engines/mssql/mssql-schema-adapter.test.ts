/**
 * Unit tests for MssqlSchemaAdapter using a FAKE MssqlReadonlyDriver.
 * Returns Batch-A JSON row fixtures — proves extract→RawCatalog WITHOUT a container.
 *
 * Design §adapter class "extract(scope), fingerprint(), close() idempotent, lifecycle guard".
 * TDD: RED → GREEN → REFACTOR. US-027 (SQL Server adapter), US-009 (fingerprint).
 *
 * Tests:
 *   - extract() returns RawCatalog with correct engine/schemas/objects
 *   - extract() honors scope levels (tables=off → no tables)
 *   - fingerprint() returns sha256(m|c) hex string
 *   - fingerprint() formula: different values produce different hashes
 *   - close() is idempotent
 *   - extract() after close() → ConnectionError (lifecycle guard)
 *   - fingerprint() after close() → ConnectionError (lifecycle guard)
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { MssqlSchemaAdapter } from '../../../../src/adapters/engines/mssql/mssql-schema-adapter.js';
import type { MssqlReadonlyDriver } from '../../../../src/adapters/engines/mssql/driver.js';
import { ConnectionError } from '../../../../src/core/errors.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';

// JSON fixtures
import tablesJson from '../../../fixtures/mssql/rows/tables.json' with { type: 'json' };
import columnsJson from '../../../fixtures/mssql/rows/columns.json' with { type: 'json' };
import keyConstraintsJson from '../../../fixtures/mssql/rows/key-constraints.json' with { type: 'json' };
import foreignKeysJson from '../../../fixtures/mssql/rows/foreign-keys.json' with { type: 'json' };
import checkConstraintsJson from '../../../fixtures/mssql/rows/check-constraints.json' with { type: 'json' };
import indexesJson from '../../../fixtures/mssql/rows/indexes.json' with { type: 'json' };
import modulesJson from '../../../fixtures/mssql/rows/modules.json' with { type: 'json' };
import triggerEventsJson from '../../../fixtures/mssql/rows/trigger-events.json' with { type: 'json' };
import sequencesJson from '../../../fixtures/mssql/rows/sequences.json' with { type: 'json' };
import extendedPropertiesJson from '../../../fixtures/mssql/rows/extended-properties.json' with { type: 'json' };
import dependenciesJson from '../../../fixtures/mssql/rows/dependencies.json' with { type: 'json' };

// ─────────────────────────────────────────────────────────────────────────────
// Fake driver: routes SQL query to the right fixture by matching a keyword
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the appropriate fixture rows by inspecting the SQL string.
 * This is a fake (plain object), NOT a vi.mock — no mssql module involved.
 */
function makeFakeDriver(fingerprintRow?: Record<string, unknown>): MssqlReadonlyDriver {
  const fp: Record<string, unknown> = fingerprintRow ?? {
    m: '2024-01-15 10:30:00',
    c: 42,
  };

  return {
    async query(sql: string): Promise<readonly Record<string, unknown>[]> {
      const s = sql.toLowerCase();

      // Fingerprint query — matches before any table-level check
      if (s.includes('max(modify_date)')) {
        return [fp];
      }

      // Match by the PRIMARY join — ordered from most-specific to least-specific
      if (s.includes('sys.sql_expression_dependencies')) {
        return dependenciesJson as readonly Record<string, unknown>[];
      }
      if (s.includes('sys.extended_properties')) {
        return extendedPropertiesJson as readonly Record<string, unknown>[];
      }
      if (s.includes('sys.sequences')) {
        return sequencesJson as readonly Record<string, unknown>[];
      }
      if (s.includes('sys.triggers')) {
        return triggerEventsJson as readonly Record<string, unknown>[];
      }
      if (s.includes('sys.key_constraints')) {
        return keyConstraintsJson as readonly Record<string, unknown>[];
      }
      if (s.includes('sys.foreign_keys')) {
        return foreignKeysJson as readonly Record<string, unknown>[];
      }
      if (s.includes('sys.check_constraints')) {
        return checkConstraintsJson as readonly Record<string, unknown>[];
      }
      if (s.includes('sys.indexes')) {
        return indexesJson as readonly Record<string, unknown>[];
      }
      // sys.objects query (modules: views/procs/functions/triggers)
      if (s.includes('sys.objects') && s.includes("type in")) {
        return modulesJson as readonly Record<string, unknown>[];
      }
      // sys.columns before sys.tables (columns query joins both)
      if (s.includes('sys.columns')) {
        return columnsJson as readonly Record<string, unknown>[];
      }
      // Plain tables query
      if (s.includes('sys.tables')) {
        return tablesJson as readonly Record<string, unknown>[];
      }

      // Fallback: empty result
      return [];
    },

    async close(): Promise<void> {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default full scope
// ─────────────────────────────────────────────────────────────────────────────

const FULL_SCOPE: ExtractionScope = {
  levels: DEFAULT_LEVELS,
};

// ─────────────────────────────────────────────────────────────────────────────
// extract() — RawCatalog assembly
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlSchemaAdapter.extract() — RawCatalog', () => {
  it('returns engine "mssql"', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const catalog = await adapter.extract(FULL_SCOPE);

    expect(catalog.engine).toBe('mssql');

    await adapter.close();
  });

  it('schemas array contains "dbo" (from fixture tables)', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const catalog = await adapter.extract(FULL_SCOPE);

    expect(catalog.schemas).toContain('dbo');

    await adapter.close();
  });

  it('objects array is non-empty with full scope', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const catalog = await adapter.extract(FULL_SCOPE);

    expect(catalog.objects.length).toBeGreaterThan(0);

    await adapter.close();
  });

  it('tables from fixture appear in objects (kind = "table")', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const catalog = await adapter.extract(FULL_SCOPE);

    const tables = catalog.objects.filter((o) => o.kind === 'table');
    expect(tables.length).toBeGreaterThan(0);

    const orders = tables.find((t) => t.name === 'orders');
    expect(orders).toBeDefined();
    expect(orders!.schema).toBe('dbo');

    await adapter.close();
  });

  it('orders table has columns from fixture (order_id, customer_name, created_at)', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const catalog = await adapter.extract(FULL_SCOPE);

    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders');
    expect(orders).toBeDefined();

    const columnNames = (orders!.columns ?? []).map((c) => c.name);
    expect(columnNames).toContain('order_id');
    expect(columnNames).toContain('customer_name');
    expect(columnNames).toContain('created_at');

    await adapter.close();
  });

  it('scope.levels.tables = "off" → no table objects in catalog', async () => {
    const offScope: ExtractionScope = {
      levels: {
        ...DEFAULT_LEVELS,
        tables: 'off',
      },
    };

    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const catalog = await adapter.extract(offScope);

    const tables = catalog.objects.filter((o) => o.kind === 'table');
    expect(tables).toHaveLength(0);

    await adapter.close();
  });

  it('objects are sorted deterministically (kindRank, schema, name)', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const catalog = await adapter.extract(FULL_SCOPE);

    // Tables come before procedures/functions in the kind rank ordering
    const kindOrder = catalog.objects.map((o) => o.kind);

    const firstTable = kindOrder.indexOf('table');
    const firstProc = kindOrder.indexOf('procedure');

    // If both exist, table (rank 2) must appear before procedure (rank 8)
    if (firstTable !== -1 && firstProc !== -1) {
      expect(firstTable).toBeLessThan(firstProc);
    }

    await adapter.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fingerprint() — sha256(m|c) formula
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlSchemaAdapter.fingerprint()', () => {
  it('returns a 64-character hex string (sha256)', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    const fp = await adapter.fingerprint();

    expect(fp).toMatch(/^[0-9a-f]{64}$/);

    await adapter.close();
  });

  it('formula: sha256(`${m}|${c}`) matches expected hash', async () => {
    const m = '2024-01-15 10:30:00';
    const c = 42;
    const adapter = new MssqlSchemaAdapter(makeFakeDriver({ m, c }));

    const fp = await adapter.fingerprint();

    const expected = createHash('sha256').update(`${m}|${c}`).digest('hex');
    expect(fp).toBe(expected);

    await adapter.close();
  });

  it('different m value → different fingerprint', async () => {
    const driver1 = makeFakeDriver({ m: '2024-01-01 00:00:00', c: 10 });
    const driver2 = makeFakeDriver({ m: '2024-02-01 00:00:00', c: 10 });

    const adapter1 = new MssqlSchemaAdapter(driver1);
    const adapter2 = new MssqlSchemaAdapter(driver2);

    const fp1 = await adapter1.fingerprint();
    const fp2 = await adapter2.fingerprint();

    expect(fp1).not.toBe(fp2);

    await adapter1.close();
    await adapter2.close();
  });

  it('different c value (count changes on CREATE/DROP) → different fingerprint', async () => {
    const driver1 = makeFakeDriver({ m: '2024-01-01 00:00:00', c: 10 });
    const driver2 = makeFakeDriver({ m: '2024-01-01 00:00:00', c: 11 });

    const adapter1 = new MssqlSchemaAdapter(driver1);
    const adapter2 = new MssqlSchemaAdapter(driver2);

    const fp1 = await adapter1.fingerprint();
    const fp2 = await adapter2.fingerprint();

    expect(fp1).not.toBe(fp2);

    await adapter1.close();
    await adapter2.close();
  });

  it('same m and c values → identical fingerprint (stable on DML, US-009)', async () => {
    const m = '2024-01-15 10:30:00';
    const c = 42;

    const adapter1 = new MssqlSchemaAdapter(makeFakeDriver({ m, c }));
    const adapter2 = new MssqlSchemaAdapter(makeFakeDriver({ m, c }));

    const fp1 = await adapter1.fingerprint();
    const fp2 = await adapter2.fingerprint();

    expect(fp1).toBe(fp2);

    await adapter1.close();
    await adapter2.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// close() — idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlSchemaAdapter.close()', () => {
  it('resolves without throwing on first call', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());

    await expect(adapter.close()).resolves.not.toThrow();
  });

  it('second close() call is a no-op (idempotent)', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());

    await adapter.close();
    await expect(adapter.close()).resolves.not.toThrow();
  });

  it('driver.close() is called exactly once even after two adapter close() calls', async () => {
    let closeCalls = 0;
    const driver: MssqlReadonlyDriver = {
      async query(sql: string) { void sql; return []; },
      async close() { closeCalls++; },
    };

    const adapter = new MssqlSchemaAdapter(driver);
    await adapter.close();
    await adapter.close();

    expect(closeCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle guard — extract/fingerprint after close → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlSchemaAdapter — lifecycle guard (extract/fingerprint after close)', () => {
  it('extract() after close() throws ConnectionError', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    await adapter.close();

    await expect(
      adapter.extract(FULL_SCOPE),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });

  it('extract() after close() error message mentions "close"', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    await adapter.close();

    await expect(
      adapter.extract(FULL_SCOPE),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.message.toLowerCase().includes('close'),
    );
  });

  it('fingerprint() after close() throws ConnectionError', async () => {
    const adapter = new MssqlSchemaAdapter(makeFakeDriver());
    await adapter.close();

    await expect(
      adapter.fingerprint(),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });
});
