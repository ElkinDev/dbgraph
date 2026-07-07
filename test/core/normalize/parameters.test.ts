/**
 * Tests for buildPayload's routine-parameter copy (dog2-routine-parameters, Batch 1 task 1.2).
 * Spec: graph-model GM-1 (ordinal order, ADR-008), GM-2 (unset absence). Design §3.2 D2/D6.
 *
 * buildPayload copies RawObject.parameters → payload.parameters CONDITIONALLY (only when
 * present AND non-empty), ordinal-sorted defensively. Pure copy — NO edge, NO inference.
 * NO graph-normalization delta (§10 — payload copy, not a shape change).
 *
 * STRICT TDD: L-009 EXACT-set (.toStrictEqual the full RoutineParameter array) + negatives
 *   (UNSET → key ABSENT; empty → key ELIDED). RED precedes the buildPayload edit.
 */

import { describe, it, expect } from 'vitest';
import { normalizeCatalog } from '../../../src/core/normalize/normalize.js';
import { stableStringify } from '../../../src/core/normalize/id.js';
import type { RawCatalog, RawObject, RawParameter } from '../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';
import type { GraphNode } from '../../../src/core/model/node.js';

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'full',
    functions: 'full',
    triggers: 'full',
    sequences: 'full',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

function proc(name: string, parameters?: readonly RawParameter[]): RawObject {
  return {
    kind: 'procedure',
    schema: 'app',
    name,
    ...(parameters !== undefined ? { parameters } : {}),
  };
}

function normalizeOne(obj: RawObject): { node: GraphNode; result: ReturnType<typeof normalizeCatalog> } {
  const catalog: RawCatalog = { engine: 'mssql', schemas: ['app'], objects: [obj] };
  const result = normalizeCatalog(catalog, FULL_SCOPE);
  const node = result.graph.nodes.find(
    (n) => n.kind === obj.kind && n.name === obj.name.toLowerCase(),
  );
  expect(node).toBeDefined();
  return { node: node!, result };
}

describe('buildPayload — routine parameter copy (GM-1/GM-2, D2/D6)', () => {
  it('copies parameters ordinal-sorted ascending regardless of input order (GM-1, ADR-008)', () => {
    const { node } = normalizeOne(
      proc('usp_log_change', [
        { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
        { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      ]),
    );
    // EXACT-set: sorted ascending ordinal, pure copy — no fabricated hasDefault.
    expect(node.payload['parameters']).toStrictEqual([
      { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
    ]);
  });

  it('preserves a real hasDefault flag verbatim; never fabricates one (GM-3)', () => {
    const { node } = normalizeOne(
      proc('usp_with_default', [
        { name: '@amount', dataType: 'decimal', direction: 'in', ordinal: 1, hasDefault: true },
        { name: '@note', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
      ]),
    );
    const params = node.payload['parameters'] as readonly RawParameter[];
    expect(params).toStrictEqual([
      { name: '@amount', dataType: 'decimal', direction: 'in', ordinal: 1, hasDefault: true },
      { name: '@note', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
    ]);
    // NEGATIVE: the second param must NOT gain a fabricated hasDefault.
    expect('hasDefault' in params[1]!).toBe(false);
  });

  it('leaves the payload key ABSENT when parameters is UNSET (GM-2 honest absence)', () => {
    const { node } = normalizeOne(proc('usp_refresh_totals'));
    expect('parameters' in node.payload).toBe(false);
    expect(node.payload['parameters']).toBeUndefined();
  });

  it('ELIDES the key for an empty parameters array (mirrors signature/returns conditional emit)', () => {
    const { node } = normalizeOne(proc('usp_noargs', []));
    expect('parameters' in node.payload).toBe(false);
  });

  it('is a pure copy — adds NO edge and mints NO extra node (US-008 untouched)', () => {
    const { result } = normalizeOne(
      proc('usp_log_change', [
        { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      ]),
    );
    // Only the single procedure node; parameters are payload data, NOT graph nodes/edges.
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.edges).toStrictEqual([]);
  });

  it('derives byte-identically on re-run (ADR-008 determinism)', () => {
    const obj = proc('usp_log_change', [
      { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
      { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
    ]);
    const catalog: RawCatalog = { engine: 'mssql', schemas: ['app'], objects: [obj] };
    const a = stableStringify(normalizeCatalog(catalog, FULL_SCOPE).graph);
    const b = stableStringify(normalizeCatalog(catalog, FULL_SCOPE).graph);
    expect(a).toBe(b);
  });
});
