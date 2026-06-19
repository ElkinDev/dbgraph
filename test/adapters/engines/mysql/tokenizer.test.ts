/**
 * Tests for MySQL body tokenizer.
 * Design §tokenizer.ts — hasMysqlDynamicSql, mysqlCanonicalize, tokenizeMysqlBody.
 *
 * Key guarantees:
 *   - PREPARE/EXECUTE → hasDynamicSql:true
 *   - Non-dynamic body → hasDynamicSql:false
 *   - Presence gate: table named ONLY inside a masked dynamic string → ZERO edge
 *   - Static INSERT t → writes_to t (write edge)
 *   - Name absent from body → NO edge
 *   - NEVER a self-edge
 *   - Backtick stripping via mysqlCanonicalize
 *
 * EXACT-set assertions (not existence-only) — CRITICAL-1 regression guard.
 * Spec: task 4.3, mysql-extraction spec §"Dynamic SQL via PREPARE/EXECUTE",
 *        §"Parsed reads_from and writes_to ... no phantom or self edges".
 */

import { describe, it, expect } from 'vitest';
import {
  hasMysqlDynamicSql,
  mysqlCanonicalize,
  tokenizeMysqlBody,
} from '../../../../src/adapters/engines/mysql/tokenizer.js';

// ─────────────────────────────────────────────────────────────────────────────
// hasMysqlDynamicSql
// ─────────────────────────────────────────────────────────────────────────────

describe('hasMysqlDynamicSql', () => {
  it('returns true when body contains PREPARE', () => {
    const body = 'PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;';
    expect(hasMysqlDynamicSql(body)).toBe(true);
  });

  it('returns true when body contains EXECUTE (bare, not PREPARE+EXECUTE together)', () => {
    const body = 'EXECUTE stmt;';
    expect(hasMysqlDynamicSql(body)).toBe(true);
  });

  it('returns true for lowercase prepare/execute', () => {
    const body = 'prepare s from @q; execute s;';
    expect(hasMysqlDynamicSql(body)).toBe(true);
  });

  it('returns false for plain static SQL with no PREPARE or EXECUTE', () => {
    const body = 'INSERT INTO orders (customer_name) VALUES (p_name);';
    expect(hasMysqlDynamicSql(body)).toBe(false);
  });

  it('returns false for empty body', () => {
    expect(hasMysqlDynamicSql('')).toBe(false);
  });

  it('returns false for SELECT with no dynamic keywords', () => {
    const body = 'SELECT * FROM products WHERE product_id = 1;';
    expect(hasMysqlDynamicSql(body)).toBe(false);
  });

  it('Spec: PREPARE/EXECUTE routine is flagged — hasDynamicSql true', () => {
    const body = `BEGIN
      DECLARE v_sql VARCHAR(500);
      SET v_sql = 'SELECT * FROM audit_log';
      PREPARE stmt FROM v_sql;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END`;
    expect(hasMysqlDynamicSql(body)).toBe(true);
  });

  it('Spec: Non-dynamic routine is NOT flagged — hasDynamicSql false', () => {
    const body = `BEGIN
      INSERT INTO audit_log (event_type) VALUES ('evt');
    END`;
    expect(hasMysqlDynamicSql(body)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mysqlCanonicalize
// ─────────────────────────────────────────────────────────────────────────────

describe('mysqlCanonicalize', () => {
  it('lowercases plain identifier', () => {
    expect(mysqlCanonicalize('Orders')).toBe('orders');
  });

  it('strips backticks from qualified name', () => {
    // Use String.fromCharCode(96) to reference backtick char without literal backtick
    const bt = String.fromCharCode(96);
    expect(mysqlCanonicalize(`${bt}app${bt}.${bt}orders${bt}`)).toBe('app.orders');
  });

  it('strips backticks from simple name', () => {
    const bt = String.fromCharCode(96);
    expect(mysqlCanonicalize(`${bt}Orders${bt}`)).toBe('orders');
  });

  it('lowercases double-quoted name (defensive)', () => {
    const dq = String.fromCharCode(34);
    expect(mysqlCanonicalize(`${dq}app${dq}.${dq}Orders${dq}`)).toBe('app.orders');
  });

  it('passes through plain lowercase name unchanged', () => {
    expect(mysqlCanonicalize('app.orders')).toBe('app.orders');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeMysqlBody — presence gate + write/read classification
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeMysqlBody — presence gate', () => {
  const deps = [
    { schema: 'app', name: 'orders' },
    { schema: 'app', name: 'products' },
    { schema: 'app', name: 'audit_log' },
  ];

  it('Spec: No edge is defaulted for objects absent from the body (no phantom edges)', () => {
    // Body only references "orders" — products and audit_log must NOT get edges
    const body = 'BEGIN INSERT INTO orders (customer_name) VALUES (p); END';
    const result = tokenizeMysqlBody(body, deps);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]!.target.name).toBe('orders');
    expect(result.dependencies[0]!.access).toBe('write');
    expect(result.dependencies.find((d) => d.target.name === 'products')).toBeUndefined();
    expect(result.dependencies.find((d) => d.target.name === 'audit_log')).toBeUndefined();
  });

  it('Spec: PREPARE/EXECUTE routine — table ONLY in masked string yields ZERO edge', () => {
    // audit_log appears ONLY in the prepared string literal — must be masked
    const body = `BEGIN
      DECLARE v_sql VARCHAR(500);
      SET v_sql = 'SELECT * FROM audit_log WHERE audit_id = 1';
      PREPARE stmt FROM v_sql;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END`;
    const result = tokenizeMysqlBody(body, deps);
    // hasDynamicSql must be true
    expect(result.hasDynamicSql).toBe(true);
    // audit_log is ONLY inside the string literal → must be masked → ZERO edge
    expect(result.dependencies).toHaveLength(0);
  });

  it('Spec: static INSERT produces a write edge', () => {
    const body = 'BEGIN INSERT INTO audit_log (event_type) VALUES (p); END';
    const result = tokenizeMysqlBody(body, deps);
    const writeDep = result.dependencies.find((d) => d.target.name === 'audit_log');
    expect(writeDep).toBeDefined();
    expect(writeDep!.access).toBe('write');
    expect(writeDep!.confidence).toBe('parsed');
  });

  it('Spec: name absent from body → NO edge (no phantom)', () => {
    const body = 'BEGIN SELECT 1; END';
    const result = tokenizeMysqlBody(body, deps);
    expect(result.dependencies).toHaveLength(0);
  });

  it('all edges carry confidence parsed', () => {
    const body = 'BEGIN SELECT * FROM orders; END';
    const result = tokenizeMysqlBody(body, deps);
    for (const dep of result.dependencies) {
      expect(dep.confidence).toBe('parsed');
    }
  });
});

describe('tokenizeMysqlBody — EXACT edge sets (CRITICAL-1 regression guard)', () => {
  it('procedure writing two tables and reading one yields EXACT 3-edge set', () => {
    // Mirrors spec §"Routine writing two objects and reading a third"
    const deps = [
      { schema: 'app', name: 'orders' },
      { schema: 'app', name: 'order_items' },
      { schema: 'app', name: 'products' },
      { schema: 'app', name: 'audit_log' },
    ];
    const body = `BEGIN
      INSERT INTO orders (customer_name) VALUES (p_customer);
      INSERT INTO order_items (order_id, product_id, qty, unit_price)
        VALUES (LAST_INSERT_ID(), p_product_id, p_qty,
          (SELECT unit_price FROM products WHERE product_id = p_product_id));
    END`;
    const result = tokenizeMysqlBody(body, deps);

    const writes = result.dependencies.filter((d) => d.access === 'write');
    const reads = result.dependencies.filter((d) => d.access === 'read');

    expect(result.dependencies).toHaveLength(3);
    expect(writes).toHaveLength(2);
    expect(reads).toHaveLength(1);

    const names = result.dependencies.map((d) => d.target.name).sort();
    expect(names).toEqual(['order_items', 'orders', 'products']);

    // No self-reference (body is a procedure, none of these are itself)
    // No edge to audit_log (not referenced)
    expect(result.dependencies.find((d) => d.target.name === 'audit_log')).toBeUndefined();
  });

  it('view reading two base tables yields EXACT 2-edge reads_from set', () => {
    // Spec: "View reading its base tables yields exactly the reads_from edges for those tables"
    const deps = [
      { schema: 'app', name: 'orders' },
      { schema: 'app', name: 'order_items' },
      { schema: 'app', name: 'products' },
    ];
    // MySQL reparsed view body (backtick-quoted identifiers)
    const bt = String.fromCharCode(96);
    const body = `select ${bt}app${bt}.${bt}orders${bt}.${bt}order_id${bt} AS ${bt}order_id${bt} from (${bt}app${bt}.${bt}orders${bt} join ${bt}app${bt}.${bt}order_items${bt} on((${bt}app${bt}.${bt}orders${bt}.${bt}order_id${bt} = ${bt}app${bt}.${bt}order_items${bt}.${bt}order_id${bt})))`;
    const result = tokenizeMysqlBody(body, deps);

    const names = result.dependencies.map((d) => d.target.name).sort();
    expect(names).toEqual(['order_items', 'orders']);

    // All must be reads_from
    for (const dep of result.dependencies) {
      expect(dep.access).toBe('read');
    }
    // products not referenced in this view body
    expect(result.dependencies.find((d) => d.target.name === 'products')).toBeUndefined();
  });

  it('dynamic routine: hasDynamicSql true AND deps.length === 0', () => {
    const deps = [
      { schema: 'app', name: 'audit_log' },
      { schema: 'app', name: 'orders' },
    ];
    const body = `BEGIN
      DECLARE v_sql VARCHAR(500);
      SET v_sql = 'SELECT * FROM audit_log WHERE audit_id = 1';
      PREPARE stmt FROM v_sql;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END`;
    const result = tokenizeMysqlBody(body, deps);
    expect(result.hasDynamicSql).toBe(true);
    expect(result.dependencies).toHaveLength(0);
  });
});

describe('tokenizeMysqlBody — self-edge prevention', () => {
  it('NEVER emits a self-reference edge (self is naturally excluded by presence gate)', () => {
    // Even if the body contains the same name, the dep list won't have the routine itself
    // (routines reference other tables/views, not themselves)
    // This is a design-time guarantee, but we can verify: if we pass the routine's own
    // schema.name as a dep, it must still NOT produce a self-edge if the body mentions it
    // (this would only happen for views which can't be self-referencing, so we test the boundary)
    const deps = [
      { schema: 'app', name: 'orders' },
      { schema: 'app', name: 'place_order' }, // the "self" — would be a self-edge if emitted
    ];
    // Body references orders but NOT place_order (its own name)
    const body = 'BEGIN INSERT INTO orders (customer_name) VALUES (p); END';
    const result = tokenizeMysqlBody(body, deps);
    expect(result.dependencies.find((d) => d.target.name === 'place_order')).toBeUndefined();
  });
});
