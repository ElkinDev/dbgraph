/**
 * Tests for the mssql body tokenizer.
 * Design: conservative read/write classifier over sys.sql_modules.definition.
 * US-007 (reads_from / writes_to classification; dynamic SQL flagged, not guessed).
 * ADR-007 (NO T-SQL parser — conservative tokenizer only).
 *
 * TDD RED → GREEN → REFACTOR
 * Pure unit tests — NO database, NO mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAccess,
  hasDynamicSql,
  canonicalizeQName,
  tokenizeModuleDeps,
} from '../../../../src/adapters/engines/mssql/tokenizer.js';

// ─────────────────────────────────────────────────────────────────────────────
// canonicalizeQName: bracket/quote normalization
// ─────────────────────────────────────────────────────────────────────────────

describe('canonicalizeQName — bracket and quote normalization', () => {
  it('strips brackets from [schema].[name]', () => {
    expect(canonicalizeQName('[dbo].[orders]')).toBe('dbo.orders');
  });

  it('strips double-quotes from "schema"."name"', () => {
    expect(canonicalizeQName('"dbo"."orders"')).toBe('dbo.orders');
  });

  it('lowercases the result', () => {
    expect(canonicalizeQName('[DBO].[Orders]')).toBe('dbo.orders');
  });

  it('handles mixed brackets/no-brackets', () => {
    expect(canonicalizeQName('[dbo].orders')).toBe('dbo.orders');
  });

  it('handles plain schema.name without brackets', () => {
    expect(canonicalizeQName('dbo.orders')).toBe('dbo.orders');
  });

  it('handles single-part names (no schema)', () => {
    expect(canonicalizeQName('[orders]')).toBe('orders');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyAccess: write-verb classification
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyAccess — write verbs produce "write"', () => {
  it('INSERT INTO produces write', () => {
    const body = 'INSERT INTO dbo.audit_log (event) VALUES (\'test\')';
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });

  it('UPDATE produces write', () => {
    const body = 'UPDATE dbo.orders SET customer_name = \'x\' WHERE order_id = 1';
    expect(classifyAccess('dbo.orders', body)).toBe('write');
  });

  it('DELETE FROM produces write', () => {
    const body = 'DELETE FROM dbo.order_items WHERE order_id = 1';
    expect(classifyAccess('dbo.order_items', body)).toBe('write');
  });

  it('MERGE INTO produces write', () => {
    const body = 'MERGE INTO dbo.products AS tgt USING src ON tgt.id = src.id WHEN MATCHED THEN UPDATE SET sku = src.sku';
    expect(classifyAccess('dbo.products', body)).toBe('write');
  });

  it('TRUNCATE TABLE produces write', () => {
    const body = 'TRUNCATE TABLE dbo.audit_log';
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });
});

describe('classifyAccess — non-write produces "read"', () => {
  it('SELECT FROM produces read', () => {
    const body = 'SELECT order_id FROM dbo.orders WHERE order_id = 1';
    expect(classifyAccess('dbo.orders', body)).toBe('read');
  });

  it('object only in FROM clause produces read', () => {
    const body = 'SELECT oi.item_id, oi.qty FROM dbo.order_items oi JOIN dbo.orders o ON o.order_id = oi.order_id';
    expect(classifyAccess('dbo.order_items', body)).toBe('read');
  });

  it('object only in JOIN clause produces read', () => {
    const body = 'SELECT oi.item_id FROM dbo.order_items oi JOIN dbo.products p ON p.product_id = oi.product_id';
    expect(classifyAccess('dbo.products', body)).toBe('read');
  });
});

describe('classifyAccess — case insensitive matching', () => {
  it('insert into (lowercase) produces write', () => {
    const body = 'insert into [dbo].[audit_log] (event) values (\'x\')';
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });

  it('INSERT INTO with bracketed target produces write', () => {
    const body = 'INSERT INTO [dbo].[audit_log] (event) VALUES (\'x\')';
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });

  it('update with mixed case produces write', () => {
    const body = 'Update [DBO].[Orders] SET customer_name = \'y\'';
    expect(classifyAccess('dbo.orders', body)).toBe('write');
  });
});

describe('classifyAccess — target match is qname-based, not substring', () => {
  it('audit_log write does not affect orders (different target)', () => {
    const body = 'INSERT INTO dbo.audit_log (event) VALUES (\'x\'); SELECT order_id FROM dbo.orders';
    // orders is only read, not written
    expect(classifyAccess('dbo.orders', body)).toBe('read');
    // audit_log is written
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasDynamicSql: EXEC / sp_executesql detection
// ─────────────────────────────────────────────────────────────────────────────

describe('hasDynamicSql — dynamic SQL detection', () => {
  it('EXEC sp_executesql detected', () => {
    const body = 'DECLARE @sql NVARCHAR(MAX) = N\'SELECT * FROM \' + @t; EXEC sp_executesql @sql';
    expect(hasDynamicSql(body)).toBe(true);
  });

  it('EXEC alone detected', () => {
    const body = 'EXEC dbo.usp_other_proc';
    expect(hasDynamicSql(body)).toBe(true);
  });

  it('case-insensitive exec detected', () => {
    const body = 'exec sp_executesql N\'SELECT 1\'';
    expect(hasDynamicSql(body)).toBe(true);
  });

  it('no EXEC or sp_executesql returns false', () => {
    const body = 'SELECT order_id FROM dbo.orders WHERE order_id = 1';
    expect(hasDynamicSql(body)).toBe(false);
  });

  it('INSERT without dynamic SQL returns false', () => {
    const body = 'INSERT INTO dbo.audit_log (event) VALUES (\'x\')';
    expect(hasDynamicSql(body)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeModuleDeps: full dependency classification with module body
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeModuleDeps — procedure writing two tables and reading one', () => {
  it('classifies INSERT target as write and SELECT target as read', () => {
    const body =
      'CREATE PROCEDURE dbo.usp_process_order @order_id INT AS BEGIN ' +
      'INSERT INTO dbo.audit_log (event, ref_id) VALUES (\'process\', @order_id); ' +
      'UPDATE dbo.orders SET customer_name = customer_name WHERE order_id = @order_id; ' +
      'SELECT order_id FROM dbo.order_items WHERE order_id = @order_id ' +
      'END';

    const deps = [
      { ref_schema_name: 'dbo', ref_object_name: 'audit_log' },
      { ref_schema_name: 'dbo', ref_object_name: 'orders' },
      { ref_schema_name: 'dbo', ref_object_name: 'order_items' },
    ];

    const result = tokenizeModuleDeps(body, deps);

    expect(result.hasDynamicSql).toBe(false);
    expect(result.dependencies).toHaveLength(3);

    const auditDep = result.dependencies.find((d) => d.target.name === 'audit_log');
    expect(auditDep).toBeDefined();
    expect(auditDep!.access).toBe('write');
    expect(auditDep!.confidence).toBe('parsed');

    const ordersDep = result.dependencies.find((d) => d.target.name === 'orders');
    expect(ordersDep).toBeDefined();
    expect(ordersDep!.access).toBe('write');

    const itemsDep = result.dependencies.find((d) => d.target.name === 'order_items');
    expect(itemsDep).toBeDefined();
    expect(itemsDep!.access).toBe('read');
  });
});

describe('tokenizeModuleDeps — dynamic SQL proc is flagged with no edges invented', () => {
  it('hasDynamicSql is true and null refs produce no dependency', () => {
    const body =
      'CREATE PROCEDURE dbo.usp_dynamic @table NVARCHAR(128) AS BEGIN ' +
      'DECLARE @sql NVARCHAR(MAX) = N\'SELECT * FROM \' + @table; ' +
      'EXEC sp_executesql @sql ' +
      'END';

    const deps = [
      { ref_schema_name: null as string | null, ref_object_name: null as string | null },
    ];

    const result = tokenizeModuleDeps(body, deps);
    expect(result.hasDynamicSql).toBe(true);
    // null refs are skipped — no fabricated edges
    expect(result.dependencies).toHaveLength(0);
  });
});

describe('tokenizeModuleDeps — AFTER UPDATE trigger writes audit', () => {
  it('trigger body with INSERT INTO audit_log classified as write', () => {
    const body =
      'CREATE TRIGGER dbo.tr_audit_orders ON dbo.orders AFTER UPDATE AS BEGIN ' +
      'INSERT INTO dbo.audit_log (event, ref_id) SELECT \'updated\', order_id FROM inserted ' +
      'END';

    const deps = [{ ref_schema_name: 'dbo', ref_object_name: 'audit_log' }];

    const result = tokenizeModuleDeps(body, deps);
    expect(result.hasDynamicSql).toBe(false);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]!.access).toBe('write');
    expect(result.dependencies[0]!.confidence).toBe('parsed');
    expect(result.dependencies[0]!.target.name).toBe('audit_log');
  });
});

describe('tokenizeModuleDeps — MERGE INTO write classification', () => {
  it('MERGE INTO target is classified as write', () => {
    const body =
      'MERGE INTO [dbo].[products] AS tgt ' +
      'USING (SELECT product_id, sku FROM dbo.order_items) AS src ' +
      'ON tgt.product_id = src.product_id ' +
      'WHEN MATCHED THEN UPDATE SET tgt.sku = src.sku';

    const deps = [
      { ref_schema_name: 'dbo', ref_object_name: 'products' },
      { ref_schema_name: 'dbo', ref_object_name: 'order_items' },
    ];

    const result = tokenizeModuleDeps(body, deps);
    const productsDep = result.dependencies.find((d) => d.target.name === 'products');
    const itemsDep = result.dependencies.find((d) => d.target.name === 'order_items');
    expect(productsDep!.access).toBe('write');
    expect(itemsDep!.access).toBe('read');
  });
});

describe('tokenizeModuleDeps — scalar function only reads', () => {
  it('SELECT-only body produces all read deps', () => {
    const body =
      'CREATE FUNCTION dbo.fn_total(@order_id INT) RETURNS DECIMAL(18,2) AS BEGIN ' +
      'DECLARE @total DECIMAL(18,2); ' +
      'SELECT @total = SUM(total) FROM dbo.order_items WHERE order_id = @order_id; ' +
      'RETURN @total ' +
      'END';

    const deps = [{ ref_schema_name: 'dbo', ref_object_name: 'order_items' }];

    const result = tokenizeModuleDeps(body, deps);
    expect(result.hasDynamicSql).toBe(false);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]!.access).toBe('read');
  });
});

describe('tokenizeModuleDeps — TRUNCATE TABLE produces write', () => {
  it('TRUNCATE TABLE target is write', () => {
    const body = 'TRUNCATE TABLE [dbo].[audit_log]';
    const deps = [{ ref_schema_name: 'dbo', ref_object_name: 'audit_log' }];
    const result = tokenizeModuleDeps(body, deps);
    expect(result.dependencies[0]!.access).toBe('write');
  });
});
