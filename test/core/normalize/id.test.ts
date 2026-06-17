/**
 * RED test: deterministic ID derivation (design §3.4, ADR-008).
 * Verifies: same qname → same id, kind disambiguation, stub-upgrade id equality.
 * References: US-006 (stable identity), graph-model spec "Each node declares kind and stable identity".
 */

import { describe, it, expect } from 'vitest';
import { nodeId, edgeId, canonicalQName, stableStringify } from '../../../src/core/normalize/id.js';

describe('nodeId', () => {
  it('produces a 40-character lowercase hex string', () => {
    const id = nodeId('table', 'dbo.orders');
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is deterministic: same kind+qname yields the same id', () => {
    expect(nodeId('table', 'dbo.orders')).toBe(nodeId('table', 'dbo.orders'));
  });

  it('differs across kinds for the same qname (kind disambiguation)', () => {
    expect(nodeId('table', 'dbo.orders')).not.toBe(nodeId('view', 'dbo.orders'));
  });

  it('differs across distinct qnames for the same kind', () => {
    expect(nodeId('table', 'dbo.orders')).not.toBe(nodeId('table', 'dbo.customers'));
  });

  it('stub-upgrade identity: stub derived from same qname matches real node id', () => {
    const real = nodeId('table', 'dbo.dropped_table');
    const stub = nodeId('table', 'dbo.dropped_table');
    expect(real).toBe(stub);
  });

  it('is case-insensitive (case-folded qname)', () => {
    expect(nodeId('table', 'dbo.Orders')).toBe(nodeId('table', 'dbo.orders'));
  });
});

describe('edgeId', () => {
  const src = nodeId('table', 'dbo.orders');
  const dst = nodeId('table', 'dbo.customers');

  it('produces a 40-character lowercase hex string', () => {
    const id = edgeId('references', src, dst, 'customer_id>id');
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is deterministic for same inputs', () => {
    expect(edgeId('references', src, dst, 'customer_id>id')).toBe(
      edgeId('references', src, dst, 'customer_id>id'),
    );
  });

  it('differs for different discriminators (per-column vs aggregate)', () => {
    expect(edgeId('references', src, dst, 'customer_id>id')).not.toBe(
      edgeId('references', src, dst, 'aggregate'),
    );
  });

  it('differs for different edge kinds on the same node pair', () => {
    expect(edgeId('references', src, dst, '')).not.toBe(
      edgeId('depends_on', src, dst, ''),
    );
  });

  it('differs for swapped src/dst', () => {
    expect(edgeId('references', src, dst, '')).not.toBe(
      edgeId('references', dst, src, ''),
    );
  });
});

describe('canonicalQName', () => {
  it('joins schema and name with a dot', () => {
    expect(canonicalQName('dbo', 'orders')).toBe('dbo.orders');
  });

  it('returns just name when schema is null', () => {
    expect(canonicalQName(null, 'my_db')).toBe('my_db');
  });

  it('case-folds to lowercase', () => {
    expect(canonicalQName('DBO', 'Orders')).toBe('dbo.orders');
  });

  it('strips SQL bracket quoting', () => {
    expect(canonicalQName('[dbo]', '[Orders]')).toBe('dbo.orders');
  });

  it('strips double-quote quoting', () => {
    expect(canonicalQName('"dbo"', '"orders"')).toBe('dbo.orders');
  });
});

describe('stableStringify', () => {
  it('produces sorted-key JSON', () => {
    const obj = { z: 1, a: 2, m: 3 };
    expect(stableStringify(obj)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('is deterministic across calls for the same value', () => {
    const obj = { b: 'hello', a: 42 };
    expect(stableStringify(obj)).toBe(stableStringify(obj));
  });

  it('sorts nested objects recursively', () => {
    const obj = { z: { b: 1, a: 2 }, a: 0 };
    expect(stableStringify(obj)).toBe('{"a":0,"z":{"a":2,"b":1}}');
  });

  it('preserves arrays without sorting their elements', () => {
    const obj = { items: [3, 1, 2] };
    expect(stableStringify(obj)).toBe('{"items":[3,1,2]}');
  });
});
