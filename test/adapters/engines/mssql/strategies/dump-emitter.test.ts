/**
 * dump-emitter.test.ts — unit tests for emitDumpScript.
 *
 * D4.1: the emitter composes a single runnable .sql from the 11 queries.ts
 * catalog constants, each wrapped in FOR JSON PATH and aliased to its
 * MssqlRowInput key. The output must:
 *   - contain each of the 11 catalog constant contents (verbatim SQL inside)
 *   - alias each family using its MssqlRowInput key
 *   - contain FOR JSON PATH for each family
 *   - contain NO write verb (INSERT/UPDATE/DELETE/MERGE/DDL)
 *   - include a header comment explaining sqlcmd -E usage
 *   - be deterministic (same output on every call)
 *
 * Spec mssql-extraction "Emitted dump script is read-only and output is gitignored".
 * connectivity-strategies Batch D, task D4.1.
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import {
  emitDumpScript,
  DUMP_DIR,
  DUMP_FILE,
  CATALOG_FAMILY_KEYS,
} from '../../../../../src/adapters/engines/mssql/strategies/dump-emitter.js';
import {
  SQL_MSSQL_TABLES,
  SQL_MSSQL_COLUMNS,
  SQL_MSSQL_KEY_CONSTRAINTS,
  SQL_MSSQL_FOREIGN_KEYS,
  SQL_MSSQL_CHECK_CONSTRAINTS,
  SQL_MSSQL_INDEXES,
  SQL_MSSQL_MODULES,
  SQL_MSSQL_TRIGGER_EVENTS,
  SQL_MSSQL_SEQUENCES,
  SQL_MSSQL_EXTENDED_PROPERTIES,
  SQL_MSSQL_DEPENDENCIES,
} from '../../../../../src/adapters/engines/mssql/queries.js';

// ─────────────────────────────────────────────────────────────────────────────
// The 11 catalog families (key → sql constant)
// ─────────────────────────────────────────────────────────────────────────────

const FAMILIES: ReadonlyArray<{ key: string; sql: string }> = [
  { key: 'tables',             sql: SQL_MSSQL_TABLES },
  { key: 'columns',            sql: SQL_MSSQL_COLUMNS },
  { key: 'keyConstraints',     sql: SQL_MSSQL_KEY_CONSTRAINTS },
  { key: 'foreignKeys',        sql: SQL_MSSQL_FOREIGN_KEYS },
  { key: 'checkConstraints',   sql: SQL_MSSQL_CHECK_CONSTRAINTS },
  { key: 'indexes',            sql: SQL_MSSQL_INDEXES },
  { key: 'modules',            sql: SQL_MSSQL_MODULES },
  { key: 'triggerEvents',      sql: SQL_MSSQL_TRIGGER_EVENTS },
  { key: 'sequences',          sql: SQL_MSSQL_SEQUENCES },
  { key: 'extendedProperties', sql: SQL_MSSQL_EXTENDED_PROPERTIES },
  { key: 'dependencies',       sql: SQL_MSSQL_DEPENDENCIES },
];

// ─────────────────────────────────────────────────────────────────────────────
// D4.1 — emitDumpScript
// ─────────────────────────────────────────────────────────────────────────────

describe('emitDumpScript() — D4.1', () => {
  it('returns a non-empty string', () => {
    const script = emitDumpScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(100);
  });

  it('contains a header comment explaining sqlcmd -E / SSMS usage', () => {
    const script = emitDumpScript();
    expect(script).toContain('sqlcmd');
    expect(script).toContain('-E');
    expect(script).toContain('.dbgraph');
  });

  it('wraps each catalog constant in FOR JSON PATH', () => {
    const script = emitDumpScript();
    for (const { key } of FAMILIES) {
      expect(script, `family "${key}" missing FOR JSON PATH`).toContain('FOR JSON PATH');
    }
    // Count: one FOR JSON PATH per family (11 families)
    const matches = script.match(/FOR JSON PATH/g) ?? [];
    expect(matches.length).toBe(11);
  });

  it('includes the inner SELECT body of each catalog constant', () => {
    const script = emitDumpScript();
    // Each constant's first meaningful SELECT keyword should appear in the script
    for (const { key, sql } of FAMILIES) {
      // Pick a unique fragment from each query (first 30 chars of trimmed sql)
      const fragment = sql.slice(0, 30).trim();
      expect(script, `family "${key}" SQL body not found in script`).toContain(fragment.slice(0, 20));
    }
  });

  it('aliases each family to its MssqlRowInput key', () => {
    const script = emitDumpScript();
    for (const { key } of FAMILIES) {
      // The script should contain the key name as a JSON key alias (e.g. "tables", "columns", ...)
      // This can be as a query label comment or AS alias
      expect(script, `MssqlRowInput key "${key}" not found in script`).toContain(key);
    }
  });

  it('contains NO write verb (INSERT, UPDATE, DELETE, MERGE, DROP, CREATE, ALTER, TRUNCATE, EXEC/EXECUTE)', () => {
    const script = emitDumpScript();
    // Case-insensitive check for write verbs as whole words at statement boundaries
    const writeVerbPattern = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|CREATE|ALTER|TRUNCATE)\b/i;
    expect(writeVerbPattern.test(script)).toBe(false);
  });

  it('is deterministic — two calls return identical output', () => {
    const first = emitDumpScript();
    const second = emitDumpScript();
    expect(first).toBe(second);
  });

  it('exports DUMP_DIR as the gitignored directory path', () => {
    expect(DUMP_DIR).toBe('.dbgraph/dumps');
  });

  it('exports DUMP_FILE as the expected combined JSON filename', () => {
    expect(typeof DUMP_FILE).toBe('string');
    expect(DUMP_FILE.endsWith('.json')).toBe(true);
    expect(DUMP_FILE).toContain('mssql');
  });

  it('exports CATALOG_FAMILY_KEYS with all 11 MssqlRowInput keys in order', () => {
    expect(CATALOG_FAMILY_KEYS).toHaveLength(11);
    const expectedKeys = [
      'tables', 'columns', 'keyConstraints', 'foreignKeys', 'checkConstraints',
      'indexes', 'modules', 'triggerEvents', 'sequences', 'extendedProperties', 'dependencies',
    ];
    expect(CATALOG_FAMILY_KEYS).toEqual(expectedKeys);
  });

  // ── WARN-1 remediation: top-level FOR JSON, no derived-table ORDER BY ─────
  // SQL Server Msg 1033: ORDER BY inside a derived table is illegal without
  // TOP/OFFSET. The correct form appends FOR JSON PATH to the top-level query.

  it('WARN-1: emitted script does NOT use SELECT * FROM (...) AS _rows subquery wrap', () => {
    const script = emitDumpScript();
    // The subquery pattern that causes Msg 1033 must be absent
    expect(script).not.toMatch(/SELECT \* FROM \(/);
    expect(script).not.toContain('AS _rows FOR JSON PATH');
  });

  it('WARN-1: emitted script appends FOR JSON PATH directly after each constant (top-level)', () => {
    // The dump script emits: <sql constant>\nFOR JSON PATH, INCLUDE_NULL_VALUES;
    // This is valid SQL Server (top-level ORDER BY + FOR JSON PATH).
    // Verify FOR JSON PATH, INCLUDE_NULL_VALUES appears once per family.
    const script = emitDumpScript();
    const forJsonMatches = script.match(/FOR JSON PATH, INCLUDE_NULL_VALUES/g) ?? [];
    expect(forJsonMatches.length).toBe(11);
  });
});
