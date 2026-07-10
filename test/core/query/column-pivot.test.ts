/**
 * DOG-3 C.1 — pure `filterReadersByColumn(edges, pivotCol)` (design D6).
 * Spec: graph-query "Depth-limited impact closure" (the `attrs.dstColumns` membership +
 * absence-include rule).
 *
 * PINNED semantics (design.md Interfaces/Contracts, verbatim):
 *   dstColumns present + includes pivot -> affected (INCLUDE)
 *   dstColumns present + excludes pivot -> EXCLUDE (precision)
 *   dstColumns ABSENT                   -> INCLUDE (degrade = no false negative)
 *
 * L-009: all three arms pinned, positives AND negatives, over synthetic edge sets.
 */

import { describe, it, expect } from 'vitest';
import { filterReadersByColumn } from '../../../src/core/query/column-pivot.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

function edge(id: string, dstColumns?: readonly string[]): GraphEdge {
  return {
    id,
    kind: 'depends_on',
    src: `view-${id}`,
    dst: `table-${id}`,
    confidence: dstColumns !== undefined ? 'declared' : 'parsed',
    score: null,
    attrs: dstColumns !== undefined ? { dstColumns } : {},
  };
}

describe('filterReadersByColumn — three-arm precision (D6)', () => {
  it('ARM 1: dstColumns PRESENT + INCLUDES pivot -> INCLUDED (positive)', () => {
    const e = edge('a', ['customer_id', 'order_id', 'status']);
    expect(filterReadersByColumn([e], 'order_id')).toStrictEqual([e]);
  });

  it('ARM 2: dstColumns PRESENT + EXCLUDES pivot -> EXCLUDED (negative, precision)', () => {
    const e = edge('a', ['customer_id', 'order_id', 'status']);
    expect(filterReadersByColumn([e], 'region_id')).toStrictEqual([]);
  });

  it('ARM 3: dstColumns ABSENT (object grain) -> INCLUDED (degrade, no false negative)', () => {
    const e = edge('a'); // no dstColumns
    expect(filterReadersByColumn([e], 'anything')).toStrictEqual([e]);
  });

  it('mixed-grain traversal: a declared-excluding edge and an absent-grain edge in the SAME call', () => {
    const declaredIncludes = edge('inc', ['product_id', 'order_id']);
    const declaredExcludes = edge('exc', ['order_id']); // does NOT list product_id
    const absent = edge('abs'); // no dstColumns at all
    const result = filterReadersByColumn([declaredIncludes, declaredExcludes, absent], 'product_id');
    // EXACT set: the including edge + the absent (degraded) edge; the excluding edge is OUT.
    expect(result).toStrictEqual([declaredIncludes, absent]);
    expect(result).not.toContainEqual(declaredExcludes);
  });

  it('empty edge list -> empty result', () => {
    expect(filterReadersByColumn([], 'x')).toStrictEqual([]);
  });

  it('multiple present edges, only exact matches pass (exact-set, no over-approximation)', () => {
    const a = edge('a', ['x', 'y']);
    const b = edge('b', ['y', 'z']);
    const c = edge('c', ['z']);
    const result = filterReadersByColumn([a, b, c], 'y');
    expect(result).toStrictEqual([a, b]);
    expect(result).not.toContainEqual(c);
  });

  it('does NOT mutate the input array or edge objects (pure function)', () => {
    const e = edge('a', ['x']);
    const edges = [e];
    const before = JSON.stringify(edges);
    filterReadersByColumn(edges, 'x');
    expect(JSON.stringify(edges)).toBe(before);
  });
});
