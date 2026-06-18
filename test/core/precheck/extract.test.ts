/**
 * extractIdentifiers unit tests — task 4.3 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph_precheck extractor unit — ALTER TABLE / CREATE|DROP INDEX / ADD|DROP COLUMN.
 * Design: PURE, reuses MSSQL tokenizer.ts [\w.]+ + bracket-strip patterns;
 *         case-insensitive, deduped, inline DDL strings, NO DB.
 *
 * TDD RED: module does not exist yet. Import fails → RED.
 */

import { describe, it, expect } from 'vitest';
import { extractIdentifiers } from '../../../src/core/precheck/extract.js';

// ─────────────────────────────────────────────────────────────────────────────
// ALTER TABLE
// ─────────────────────────────────────────────────────────────────────────────

describe('extractIdentifiers — ALTER TABLE', () => {
  it('extracts table name from ALTER TABLE ... ADD COLUMN', () => {
    const ids = extractIdentifiers('ALTER TABLE employees ADD COLUMN status TEXT');
    expect(ids).toContain('employees');
  });

  it('extracts table name from ALTER TABLE ... DROP COLUMN', () => {
    const ids = extractIdentifiers('ALTER TABLE dbo.orders DROP COLUMN status');
    expect(ids).toContain('dbo.orders');
  });

  it('extracts table name from ALTER TABLE ... ADD COLUMN (case-insensitive)', () => {
    const ids = extractIdentifiers('alter table DBO.Orders add column total DECIMAL');
    expect(ids).toContain('dbo.orders');
  });

  it('extracts both table and column from ALTER TABLE ... ADD COLUMN', () => {
    const ids = extractIdentifiers('ALTER TABLE employees ADD COLUMN status TEXT');
    expect(ids).toContain('employees');
    // column name should also be included
    expect(ids).toContain('status');
  });

  it('deduplicates when same identifier appears in multiple statements', () => {
    const ddl = `
      ALTER TABLE employees ADD COLUMN status TEXT;
      ALTER TABLE employees DROP COLUMN old_column;
    `;
    const ids = extractIdentifiers(ddl);
    const employeesCount = ids.filter((id) => id === 'employees').length;
    expect(employeesCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE INDEX / DROP INDEX
// ─────────────────────────────────────────────────────────────────────────────

describe('extractIdentifiers — CREATE/DROP INDEX', () => {
  it('extracts index name from CREATE INDEX', () => {
    const ids = extractIdentifiers('CREATE INDEX ix_emp_status ON employees (status)');
    expect(ids).toContain('ix_emp_status');
  });

  it('extracts table name from CREATE INDEX ... ON table', () => {
    const ids = extractIdentifiers('CREATE INDEX ix_emp_status ON employees (status)');
    expect(ids).toContain('employees');
  });

  it('extracts index name from DROP INDEX', () => {
    const ids = extractIdentifiers('DROP INDEX ix_orders_status ON dbo.orders');
    expect(ids).toContain('ix_orders_status');
  });

  it('extracts table name from DROP INDEX ... ON table', () => {
    const ids = extractIdentifiers('DROP INDEX ix_orders_status ON dbo.orders');
    expect(ids).toContain('dbo.orders');
  });

  it('extracts index name from CREATE UNIQUE INDEX', () => {
    const ids = extractIdentifiers('CREATE UNIQUE INDEX ux_emp_email ON employees (email)');
    expect(ids).toContain('ux_emp_email');
  });

  it('handles bracketed identifiers in DROP INDEX [ix_name] ON [dbo].[table]', () => {
    const ids = extractIdentifiers('DROP INDEX [ix_orders_status] ON [dbo].[orders]');
    expect(ids).toContain('ix_orders_status');
    expect(ids).toContain('dbo.orders');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mixed DDL (ALTER + DROP INDEX together)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractIdentifiers — mixed DDL', () => {
  it('extracts all identifiers from ALTER TABLE + DROP INDEX DDL', () => {
    const ddl = `
      ALTER TABLE dbo.orders ADD COLUMN priority INT;
      DROP INDEX ix_orders_status ON dbo.orders;
    `;
    const ids = extractIdentifiers(ddl);
    expect(ids).toContain('dbo.orders');
    expect(ids).toContain('ix_orders_status');
  });

  it('returns a readonly array', () => {
    const ids = extractIdentifiers('ALTER TABLE employees ADD COLUMN x TEXT');
    // readonly string[] should still be iterable and indexable
    expect(Array.isArray(ids)).toBe(true);
  });

  it('returns empty array for empty DDL', () => {
    expect(extractIdentifiers('')).toHaveLength(0);
  });

  it('returns empty array for DDL with no recognized statements', () => {
    expect(extractIdentifiers('SELECT * FROM foo')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('extractIdentifiers — edge cases', () => {
  it('handles multi-line DDL with semicolons', () => {
    const ddl = `ALTER TABLE main.employees
      ADD COLUMN notes TEXT;
    CREATE INDEX idx_emp_notes ON main.employees (notes);`;
    const ids = extractIdentifiers(ddl);
    expect(ids).toContain('main.employees');
    expect(ids).toContain('idx_emp_notes');
  });

  it('bracket-strips and lowercases schema-qualified names', () => {
    const ids = extractIdentifiers('ALTER TABLE [DBO].[Orders] DROP COLUMN [Status]');
    expect(ids).toContain('dbo.orders');
  });
});
