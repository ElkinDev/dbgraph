/**
 * PG tokenizer tests.
 * Design §"PG hasDynamicSql — plpgsql EXECUTE statement, NOT EXECUTE FUNCTION".
 * US-028 (PostgreSQL adapter), US-007 (dynamic SQL flagged, not guessed).
 *
 * Two pinned directions (MANDATORY per tasks 4.3):
 *   1. plpgsql body with EXECUTE format(...) → hasDynamicSql: true
 *   2. trigger body whose only EXECUTE is EXECUTE FUNCTION → hasDynamicSql: false
 *
 * tokenizePgBody wires _shared/ primitives with a PG canonicalizer (dquote only).
 * All edges carry confidence: 'parsed'.
 */

import { describe, it, expect } from 'vitest';
import { hasPgDynamicSql, tokenizePgBody } from '../../../../src/adapters/engines/pg/tokenizer.js';

// ─────────────────────────────────────────────────────────────────────────────
// hasPgDynamicSql — the pinned two-direction requirement
// ─────────────────────────────────────────────────────────────────────────────

describe('hasPgDynamicSql', () => {
  it('DIRECTION 1: plpgsql body with bare EXECUTE statement is flagged true', () => {
    const body = `
CREATE OR REPLACE FUNCTION dynamic_fn()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE sql text;
BEGIN
  sql := format('SELECT * FROM %I', 'some_table');
  EXECUTE sql;
END;
$$`;
    expect(hasPgDynamicSql(body)).toBe(true);
  });

  it('DIRECTION 1: EXECUTE format(...) is flagged true', () => {
    const body = `
CREATE OR REPLACE FUNCTION dynamic_fn2()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SELECT 1 FROM %I', tbl);
END;
$$`;
    expect(hasPgDynamicSql(body)).toBe(true);
  });

  it("DIRECTION 2: trigger DDL body whose only EXECUTE is 'EXECUTE FUNCTION' is NOT flagged", () => {
    // A trigger definition string from pg_get_triggerdef — the EXECUTE FUNCTION
    // clause must NOT be treated as dynamic SQL.
    const triggerDef = 'CREATE TRIGGER trg_audit AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION audit_fn()';
    expect(hasPgDynamicSql(triggerDef)).toBe(false);
  });

  it("DIRECTION 2: 'EXECUTE PROCEDURE' trigger DDL clause is also NOT flagged", () => {
    const triggerDef = 'CREATE TRIGGER trg_old AFTER INSERT ON orders FOR EACH ROW EXECUTE PROCEDURE legacy_fn()';
    expect(hasPgDynamicSql(triggerDef)).toBe(false);
  });

  it('plain function body with no dynamic SQL is not flagged', () => {
    const body = `
CREATE OR REPLACE FUNCTION process_order(p_id int)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (action) VALUES ('done');
END;
$$`;
    expect(hasPgDynamicSql(body)).toBe(false);
  });

  it('EXECUTE FUNCTION inside trigger body plus bare EXECUTE → true (dynamic wins)', () => {
    // If a routine body has BOTH an EXECUTE FUNCTION reference AND a bare EXECUTE,
    // the bare EXECUTE should still flag it.
    const body = `
CREATE TRIGGER t AFTER UPDATE ON tbl FOR EACH ROW EXECUTE FUNCTION fn();
-- Also contains a bare EXECUTE:
BEGIN
  EXECUTE 'SELECT 1';
END;
`;
    expect(hasPgDynamicSql(body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizePgBody — dependency classification
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizePgBody', () => {
  it('classifies INSERT INTO target as write edge', () => {
    const body = `
CREATE OR REPLACE FUNCTION app.fn()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit.audit_log (action) VALUES ('x');
END;
$$`;
    const deps = [{ schema: 'audit', name: 'audit_log' }];
    const result = tokenizePgBody(body, deps);
    expect(result.hasDynamicSql).toBe(false);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]).toMatchObject({
      target: { schema: 'audit', name: 'audit_log' },
      access: 'write',
      confidence: 'parsed',
    });
  });

  it('classifies SELECT FROM target as read edge', () => {
    const body = `
CREATE OR REPLACE FUNCTION app.fn()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SELECT id FROM app.products WHERE id = 1;
END;
$$`;
    const deps = [{ schema: 'app', name: 'products' }];
    const result = tokenizePgBody(body, deps);
    expect(result.hasDynamicSql).toBe(false);
    expect(result.dependencies[0]).toMatchObject({
      target: { schema: 'app', name: 'products' },
      access: 'read',
      confidence: 'parsed',
    });
  });

  it('handles multiple deps with mixed read/write', () => {
    // process_order body: INSERT into two tables, SELECT from one
    const body = `
CREATE OR REPLACE FUNCTION app.process_order(p_id integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit.audit_log (table_name, action) VALUES ('orders', 'processed');
  INSERT INTO audit.audit_log (table_name, action) VALUES ('order_items', 'processed');
  SELECT id FROM app.products WHERE id = 1;
END;
$$`;
    const deps = [
      { schema: 'audit', name: 'audit_log' },
      { schema: 'app', name: 'products' },
    ];
    const result = tokenizePgBody(body, deps);
    expect(result.hasDynamicSql).toBe(false);
    const auditDep = result.dependencies.find((d) => d.target.name === 'audit_log');
    const prodDep = result.dependencies.find((d) => d.target.name === 'products');
    expect(auditDep?.access).toBe('write');
    expect(prodDep?.access).toBe('read');
  });

  it('returns hasDynamicSql:true when body has bare EXECUTE', () => {
    const body = `
CREATE OR REPLACE FUNCTION dynamic_fn()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SELECT %I', tbl);
END;
$$`;
    const deps: { schema: string; name: string }[] = [];
    const result = tokenizePgBody(body, deps);
    expect(result.hasDynamicSql).toBe(true);
    expect(result.dependencies).toHaveLength(0);
  });

  it('skips null deps gracefully', () => {
    const body = 'SELECT 1';
    const deps: Array<{ schema: string | null; name: string | null }> = [
      { schema: null, name: 'unknown' },
      { schema: 'app', name: null },
    ];
    const result = tokenizePgBody(
      body,
      deps.map((d) => ({ schema: d.schema ?? '', name: d.name ?? '' })),
    );
    expect(result.dependencies).toHaveLength(0);
  });

  it('view body reads_from base tables yields read edges', () => {
    const viewBody = ' SELECT o.id, o.customer_id, sum(oi.line_total) AS total FROM orders o JOIN order_items oi ON oi.order_id = o.id GROUP BY o.id, o.customer_id;';
    const deps = [
      { schema: 'app', name: 'orders' },
      { schema: 'app', name: 'order_items' },
    ];
    const result = tokenizePgBody(viewBody, deps);
    expect(result.hasDynamicSql).toBe(false);
    for (const dep of result.dependencies) {
      expect(dep.access).toBe('read');
      expect(dep.confidence).toBe('parsed');
    }
  });

  it('PG double-quote canonicalization works (no brackets)', () => {
    const body = 'SELECT id FROM "app"."products" WHERE id = 1';
    const deps = [{ schema: 'app', name: 'products' }];
    const result = tokenizePgBody(body, deps);
    expect(result.dependencies[0]?.access).toBe('read');
  });
});
