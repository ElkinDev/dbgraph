/**
 * DOG-3 A.1 — model-level pins for the consumed source-column set (column lineage).
 * Strict TDD RED: `EdgeAttrs.dstColumns`, `RawDependency.columns`, and
 * `CapabilityMatrix.supportsColumnLineage` do not yet exist — this file only
 * type-checks (tsc --noEmit) AFTER the additive fields are declared.
 *
 * Spec:
 *   graph-model      "Consumed source-column set on view depends_on via attrs.dstColumns"
 *                    (model shape + honesty: a SOURCE-column SET, never an output↔source map)
 *   schema-extraction "Optional RawDependency.columns is an engine-agnostic source-column-set contract"
 *
 * Model A (design D1/D2): the plural `dstColumns` is a NEW field; the reserved singular
 * `srcColumn`/`dstColumn` stay `references`-scoped and UNCHANGED. Optionality is honest —
 * OMITTED (unset) ≠ `[]` (exactOptionalPropertyTypes). The set is SOURCE columns a view
 * READS, NOT a mapping from an output column to a source column (ADR-006/007).
 */

import { describe, it, expect } from 'vitest';
import type { EdgeAttrs, GraphEdge } from '../../../src/core/model/edge.js';
import type { RawDependency } from '../../../src/core/model/catalog.js';
import type { CapabilityMatrix } from '../../../src/core/model/capability.js';

describe('EdgeAttrs.dstColumns — consumed SOURCE-column set on a view depends_on edge', () => {
  it('a depends_on edge carries dstColumns as a sorted-unique source-column set', () => {
    const edge: GraphEdge = {
      id: 'e-view-table',
      kind: 'depends_on',
      src: 'view-v_order_summary',
      dst: 'table-orders',
      confidence: 'declared',
      score: null,
      attrs: { dstColumns: ['customer_id', 'order_id', 'status', 'total_amount'] },
    };
    expect(edge.attrs.dstColumns).toEqual([
      'customer_id',
      'order_id',
      'status',
      'total_amount',
    ]);
    // It is a SET of source column NAMES — plain strings, never output↔source pairs.
    for (const col of edge.attrs.dstColumns ?? []) {
      expect(typeof col).toBe('string');
      expect(col).not.toContain('->');
      expect(col).not.toContain('=');
    }
  });

  it('omitting dstColumns is honest absence — the key is not present (unset ≠ [])', () => {
    const attrs: EdgeAttrs = {};
    expect('dstColumns' in attrs).toBe(false);
    expect(attrs.dstColumns).toBeUndefined();
  });

  it('dstColumns is INDEPENDENT of the references-scoped singular srcColumn/dstColumn', () => {
    // A references (FK) edge keeps using the singular column fields, untouched by DOG-3.
    const fkAttrs: EdgeAttrs = { srcColumn: 'product_id', dstColumn: 'product_id' };
    expect(fkAttrs.srcColumn).toBe('product_id');
    expect(fkAttrs.dstColumn).toBe('product_id');
    expect('dstColumns' in fkAttrs).toBe(false);

    // A view depends_on edge uses the plural set, and carries NO singular column fields.
    const viewAttrs: EdgeAttrs = { dstColumns: ['order_id', 'product_id'] };
    expect(viewAttrs.dstColumns).toEqual(['order_id', 'product_id']);
    expect('srcColumn' in viewAttrs).toBe(false);
    expect('dstColumn' in viewAttrs).toBe(false);
  });
});

describe('RawDependency.columns — engine-agnostic optional source-column-set contract', () => {
  it('a view dependency may carry a columns set of the source columns it reads', () => {
    const dep: RawDependency = {
      target: { schema: 'dbo', name: 'orders' },
      access: 'read',
      confidence: 'declared',
      columns: ['order_id', 'customer_id', 'status', 'total_amount'],
    };
    expect(dep.columns).toEqual(['order_id', 'customer_id', 'status', 'total_amount']);
    // Source-column SET only — plain names, never a mapping.
    for (const col of dep.columns ?? []) {
      expect(typeof col).toBe('string');
    }
  });

  it('a dependency without a view-column catalog leaves columns UNSET (honest absence)', () => {
    const dep: RawDependency = {
      target: { schema: 'dbo', name: 'orders' },
      access: 'read',
      confidence: 'parsed',
    };
    expect('columns' in dep).toBe(false);
    expect(dep.columns).toBeUndefined();
  });
});

describe('CapabilityMatrix.supportsColumnLineage — per-engine view-column capability flag', () => {
  it('an engine with a view-column catalog can declare supportsColumnLineage: true', () => {
    const matrix: CapabilityMatrix = {
      engine: 'mssql',
      supported: new Set(),
      defaultLevels: {
        tables: 'full', columns: 'full', constraints: 'full', indexes: 'full',
        views: 'full', procedures: 'metadata', functions: 'metadata', triggers: 'full',
        sequences: 'metadata', collections: 'metadata', fields: 'metadata',
        statistics: 'off', sampling: 'off',
      },
      supportsBodies: true,
      supportsDependencyHints: true,
      supportsColumnLineage: true,
    };
    expect(matrix.supportsColumnLineage).toBe(true);
  });

  it('supportsColumnLineage is OPTIONAL — an engine that omits it is honest absence', () => {
    const matrix: CapabilityMatrix = {
      engine: 'mongodb',
      supported: new Set(),
      defaultLevels: {
        tables: 'off', columns: 'off', constraints: 'off', indexes: 'off',
        views: 'off', procedures: 'off', functions: 'off', triggers: 'off',
        sequences: 'off', collections: 'metadata', fields: 'metadata',
        statistics: 'off', sampling: 'off',
      },
      supportsBodies: false,
      supportsDependencyHints: false,
    };
    expect('supportsColumnLineage' in matrix).toBe(false);
    expect(matrix.supportsColumnLineage).toBeUndefined();
  });
});
