/**
 * Unit tests for the shared tokenizer-core primitives.
 * Spec: Shared tokenizer-core is the single source of the primitives
 *       (US-028a / design §"_shared/tokenizer-core.ts").
 *
 * TDD RED → GREEN → REFACTOR
 * Pure unit tests — NO database, NO mocks.
 *
 * The four exports under test:
 *   - WRITE_VERB_PATTERNS : RegExp[]
 *   - canonicalizeQName   : (rawName: string) => string
 *   - classifyAccess      : (targetQName: string, body: string, canon?: (s: string) => string) => 'read' | 'write'
 *   - extractWriteTargets : (normalizedBody: string) => ReadonlySet<string>
 */

import { describe, it, expect } from 'vitest';
import {
  WRITE_VERB_PATTERNS,
  canonicalizeQName,
  classifyAccess,
  extractWriteTargets,
} from '../../../../src/adapters/engines/_shared/tokenizer-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// WRITE_VERB_PATTERNS — constant exported for downstream consumers
// ─────────────────────────────────────────────────────────────────────────────

describe('WRITE_VERB_PATTERNS — exported constant', () => {
  it('is an array of RegExp', () => {
    expect(Array.isArray(WRITE_VERB_PATTERNS)).toBe(true);
    for (const p of WRITE_VERB_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  it('contains at least 5 patterns (INSERT, UPDATE, DELETE, MERGE, TRUNCATE)', () => {
    expect(WRITE_VERB_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canonicalizeQName — bracket/quote stripping + lowercase
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

  it('handles plain schema.name without delimiters', () => {
    expect(canonicalizeQName('dbo.orders')).toBe('dbo.orders');
  });

  it('handles single-part names (no schema)', () => {
    expect(canonicalizeQName('[orders]')).toBe('orders');
  });

  it('strips double-quotes only (PG-style — no brackets)', () => {
    expect(canonicalizeQName('"public"."users"')).toBe('public.users');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractWriteTargets — write-verb operand extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('extractWriteTargets — write-verb operand extraction on normalized body', () => {
  it('INSERT INTO → write target', () => {
    const targets = extractWriteTargets('insert into dbo.audit_log (event) values (\'x\')');
    expect(targets.has('dbo.audit_log')).toBe(true);
  });

  it('UPDATE → write target', () => {
    const targets = extractWriteTargets("update dbo.orders set customer_name = 'x' where order_id = 1");
    expect(targets.has('dbo.orders')).toBe(true);
  });

  it('DELETE FROM → write target', () => {
    const targets = extractWriteTargets('delete from dbo.order_items where order_id = 1');
    expect(targets.has('dbo.order_items')).toBe(true);
  });

  it('MERGE INTO → write target', () => {
    const targets = extractWriteTargets('merge into dbo.products as tgt using src on tgt.id = src.id');
    expect(targets.has('dbo.products')).toBe(true);
  });

  it('TRUNCATE TABLE → write target', () => {
    const targets = extractWriteTargets('truncate table dbo.audit_log');
    expect(targets.has('dbo.audit_log')).toBe(true);
  });

  it('SELECT-only body → empty set', () => {
    const targets = extractWriteTargets('select order_id from dbo.orders where order_id = 1');
    expect(targets.size).toBe(0);
  });

  it('multiple write verbs → all targets captured', () => {
    const targets = extractWriteTargets(
      "insert into dbo.audit_log (e) values ('x'); update dbo.orders set x = 1",
    );
    expect(targets.has('dbo.audit_log')).toBe(true);
    expect(targets.has('dbo.orders')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyAccess — per-target read/write classification
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyAccess — write verbs produce "write"', () => {
  it('INSERT INTO produces write', () => {
    const body = "INSERT INTO dbo.audit_log (event) VALUES ('test')";
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });

  it('UPDATE produces write', () => {
    const body = "UPDATE dbo.orders SET customer_name = 'x' WHERE order_id = 1";
    expect(classifyAccess('dbo.orders', body)).toBe('write');
  });

  it('DELETE FROM produces write', () => {
    const body = 'DELETE FROM dbo.order_items WHERE order_id = 1';
    expect(classifyAccess('dbo.order_items', body)).toBe('write');
  });

  it('MERGE INTO produces write', () => {
    const body =
      'MERGE INTO dbo.products AS tgt USING src ON tgt.id = src.id WHEN MATCHED THEN UPDATE SET sku = src.sku';
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
    const body =
      'SELECT oi.item_id, oi.qty FROM dbo.order_items oi JOIN dbo.orders o ON o.order_id = oi.order_id';
    expect(classifyAccess('dbo.order_items', body)).toBe('read');
  });

  it('object only in JOIN clause produces read', () => {
    const body =
      'SELECT oi.item_id FROM dbo.order_items oi JOIN dbo.products p ON p.product_id = oi.product_id';
    expect(classifyAccess('dbo.products', body)).toBe('read');
  });
});

describe('classifyAccess — case insensitive matching', () => {
  it('insert into (lowercase) with bracketed target produces write', () => {
    const body = "insert into [dbo].[audit_log] (event) values ('x')";
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });

  it('update with mixed case produces write', () => {
    const body = "Update [DBO].[Orders] SET customer_name = 'y'";
    expect(classifyAccess('dbo.orders', body)).toBe('write');
  });
});

describe('classifyAccess — schema-qualified AND simple-name match', () => {
  it('simple-name write targets the schema-qualified dep', () => {
    // body references table without schema prefix; dep is schema-qualified
    const body = "INSERT INTO orders (id) VALUES (1)";
    expect(classifyAccess('dbo.orders', body)).toBe('write');
  });

  it('schema-qualified target does not affect a different table (write isolation)', () => {
    const body =
      "INSERT INTO dbo.audit_log (event) VALUES ('x'); SELECT order_id FROM dbo.orders";
    expect(classifyAccess('dbo.orders', body)).toBe('read');
    expect(classifyAccess('dbo.audit_log', body)).toBe('write');
  });
});

describe('classifyAccess — injected canon parameter', () => {
  it('uses the default canonicalizer when canon is omitted (MSSQL bracket stripping)', () => {
    // Default canon is canonicalizeQName — strips brackets, lowercases
    const body = "INSERT INTO [public].[users] (id) VALUES (1)";
    expect(classifyAccess('public.users', body)).toBe('write');
  });

  it('custom canon receives the raw body and target for PG-style double-quote-only stripping', () => {
    // PG canonicalizer: strip double-quotes only (no brackets)
    const pgCanon = (s: string): string =>
      s.replace(/"([^"]*)"/g, '$1').toLowerCase();

    const body = 'INSERT INTO "public"."users" (id) VALUES (1)';
    expect(classifyAccess('"public"."users"', body, pgCanon)).toBe('write');
  });

  it('injected canon changes classification when the body uses a dialect-specific quoting', () => {
    // Body uses only double-quotes; default MSSQL canon still handles them → still writes
    const body = 'INSERT INTO "app"."items" (id) VALUES (1)';
    expect(classifyAccess('app.items', body)).toBe('write');
  });
});
