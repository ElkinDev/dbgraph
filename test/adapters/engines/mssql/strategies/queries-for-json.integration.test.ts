/**
 * queries-for-json.integration.test.ts — WARN-1 remediation gate.
 *
 * Gated: requires DBGRAPH_INTEGRATION=1 (Docker). Excluded from `npm test` by
 * vitest.config.ts (*.integration.test.ts glob). Runs via:
 *   DBGRAPH_INTEGRATION=1 npm run test:integration
 *
 * Purpose:
 *   For EACH catalog query constant in queries.ts, append FOR JSON PATH,
 *   INCLUDE_NULL_VALUES and run it against the torture Testcontainer via the
 *   mssql/tedious driver (SQL auth — sa user). Assert that:
 *     1. The query returns a result without throwing (no Msg 1033 or syntax error).
 *     2. The raw result is parseable JSON (empty string or a valid JSON array).
 *
 * This validates the SQL SYNTAX of each FOR JSON form in CI without needing
 * integrated Windows auth or a real sqlcmd binary. The integrated-auth sqlcmd
 * TRANSPORT remains a Phase-6 manual item; this test covers the SQL-validity
 * class that WARN-1 is about.
 *
 * The fingerprint query uses WITHOUT_ARRAY_WRAPPER (single aggregate row).
 * It is tested separately to assert the output is a valid JSON object.
 *
 * Per-suite hookTimeout: 240s for SQL Server cold start + image pull.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startMssqlContainer,
  mssqlIntegrationEnabled,
  type MssqlContainerHandle,
} from '../../../../fixtures/mssql/container.js';
import {
  SQL_MSSQL_TABLES,
  SQL_MSSQL_COLUMNS,
  SQL_MSSQL_KEY_CONSTRAINTS,
  SQL_MSSQL_FOREIGN_KEYS,
  SQL_MSSQL_CHECK_CONSTRAINTS,
  SQL_MSSQL_INDEXES,
  SQL_MSSQL_MODULES,
  SQL_MSSQL_TRIGGER_EVENTS,
  SQL_MSSQL_PARAMETERS,
  SQL_MSSQL_SEQUENCES,
  SQL_MSSQL_EXTENDED_PROPERTIES,
  SQL_MSSQL_DEPENDENCIES,
  SQL_MSSQL_FINGERPRINT,
} from '../../../../../src/adapters/engines/mssql/queries.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Gate: DBGRAPH_INTEGRATION=1 — without it this suite is skipped by describe.skipIf.
// Run: DBGRAPH_INTEGRATION=1 npm run test:integration

const CATALOG_FAMILIES: ReadonlyArray<{ key: string; sql: string }> = [
  { key: 'tables',             sql: SQL_MSSQL_TABLES },
  { key: 'columns',            sql: SQL_MSSQL_COLUMNS },
  { key: 'keyConstraints',     sql: SQL_MSSQL_KEY_CONSTRAINTS },
  { key: 'foreignKeys',        sql: SQL_MSSQL_FOREIGN_KEYS },
  { key: 'checkConstraints',   sql: SQL_MSSQL_CHECK_CONSTRAINTS },
  { key: 'indexes',            sql: SQL_MSSQL_INDEXES },
  { key: 'modules',            sql: SQL_MSSQL_MODULES },
  { key: 'triggerEvents',      sql: SQL_MSSQL_TRIGGER_EVENTS },
  { key: 'parameters',         sql: SQL_MSSQL_PARAMETERS },
  { key: 'sequences',          sql: SQL_MSSQL_SEQUENCES },
  { key: 'extendedProperties', sql: SQL_MSSQL_EXTENDED_PROPERTIES },
  { key: 'dependencies',       sql: SQL_MSSQL_DEPENDENCIES },
];

// ─────────────────────────────────────────────────────────────────────────────
// mssql pool helper — typed minimally to avoid mandatory runtime import
// ─────────────────────────────────────────────────────────────────────────────

type MssqlPool = {
  request(): { query(sql: string): Promise<{ recordset: Array<Record<string, unknown>> }> };
  close(): Promise<void>;
};

async function openPool(config: MssqlContainerHandle['config']): Promise<MssqlPool> {
  type MssqlMod = {
    ConnectionPool: new (cfg: unknown) => { connect(): Promise<MssqlPool> };
  };
  let mssqlMod: MssqlMod;
  try {
    mssqlMod = await import('mssql' as string) as unknown as MssqlMod;
  } catch {
    throw new Error('mssql package not installed. Run: npm i mssql');
  }

  const poolCfg = {
    server: config.server,
    port: config.port,
    database: config.database,
    user: (config.authentication as { user: string }).user,
    password: (config.authentication as { password: string }).password,
    options: {
      encrypt: config.encrypt ?? true,
      trustServerCertificate: config.trustServerCertificate ?? true,
    },
  };

  return new mssqlMod.ConnectionPool(poolCfg).connect();
}

// ─────────────────────────────────────────────────────────────────────────────
// Container state
// ─────────────────────────────────────────────────────────────────────────────

let handle: MssqlContainerHandle;
let pool: MssqlPool;

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: SKIP_REASON is only referenced in comments above.
// The actual skip logic is handled by describe.skipIf (no third argument — that pattern
// is not supported in this vitest version).
describe.skipIf(!mssqlIntegrationEnabled())(
  'WARN-1 gate: catalog FOR JSON queries return valid JSON (no Msg 1033)',
  () => {
    beforeAll(async () => {
      handle = await startMssqlContainer();
      pool = await openPool(handle.config);
    }, 240_000);

    afterAll(async () => {
      if (pool !== undefined) await pool.close();
      if (handle !== undefined) await handle.stop();
    }, 60_000);

    // ── 11 catalog families ─────────────────────────────────────────────────

    for (const { key, sql } of CATALOG_FAMILIES) {
      it(`${key}: FOR JSON PATH, INCLUDE_NULL_VALUES returns parseable JSON (no Msg 1033)`, async () => {
        const forJsonSql = `${sql}\nFOR JSON PATH, INCLUDE_NULL_VALUES`;

        // The query must execute without throwing (Msg 1033 would throw here)
        const result = await pool.request().query(forJsonSql);

        // mssql driver returns FOR JSON output as a single column named
        // 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B' in the first row.
        // The value is a JSON string (or undefined/null for empty result sets).
        const firstRow = result.recordset[0] as Record<string, unknown> | undefined;

        if (firstRow === undefined) {
          // Empty result set — valid (torture schema may not have this family)
          return;
        }

        // Get the single JSON column value
        const jsonValue = Object.values(firstRow)[0];

        if (jsonValue === null || jsonValue === undefined || jsonValue === '') {
          // Empty string output from FOR JSON on empty table — valid
          return;
        }

        // Assert the value is a parseable JSON string
        expect(typeof jsonValue).toBe('string');
        const parsed: unknown = JSON.parse(jsonValue as string);
        expect(Array.isArray(parsed)).toBe(true);
      });
    }

    // ── DOG-2: the parameters family carries real rows through FOR JSON PATH ──
    it('parameters: FOR JSON PATH returns the routine parameter rows with BARE types (no Msg 1033)', async () => {
      const forJsonSql = `${SQL_MSSQL_PARAMETERS}\nFOR JSON PATH, INCLUDE_NULL_VALUES`;
      const result = await pool.request().query(forJsonSql);
      const firstRow = result.recordset[0] as Record<string, unknown> | undefined;
      expect(firstRow).toBeDefined();
      const jsonValue = Object.values(firstRow!)[0] as string;
      const rows = JSON.parse(jsonValue) as Array<Record<string, unknown>>;

      // The torture catalog has parametrized routines → non-empty, and the return row
      // (parameter_id = 0) is filtered out by the query's WHERE.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => (r['parameter_id'] as number) > 0)).toBe(true);

      // usp_log_change carries @order_id (int) and @new_status (BARE nvarchar, not nvarchar(20)).
      const logChange = rows.filter((r) => r['object_name'] === 'usp_log_change');
      expect(logChange.map((r) => r['parameter_name'])).toEqual(['@order_id', '@new_status']);
      expect(logChange.map((r) => r['data_type'])).toEqual(['int', 'nvarchar']);
    });

    // ── fingerprint (WITHOUT_ARRAY_WRAPPER) ──────────────────────────────────

    it('fingerprint: FOR JSON PATH, WITHOUT_ARRAY_WRAPPER returns a parseable JSON object (no Msg 1033)', async () => {
      const forJsonSql = `${SQL_MSSQL_FINGERPRINT}\nFOR JSON PATH, WITHOUT_ARRAY_WRAPPER`;

      const result = await pool.request().query(forJsonSql);

      const firstRow = result.recordset[0] as Record<string, unknown> | undefined;
      expect(firstRow).toBeDefined();

      const jsonValue = firstRow !== undefined ? Object.values(firstRow)[0] : undefined;
      expect(typeof jsonValue).toBe('string');

      const parsed: unknown = JSON.parse(jsonValue as string);
      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed)).toBe(false);

      // Assert m (MAX date) and c (COUNT) fields are present
      const obj = parsed as Record<string, unknown>;
      expect(obj).toHaveProperty('m');
      expect(obj).toHaveProperty('c');
    });
  },
);
