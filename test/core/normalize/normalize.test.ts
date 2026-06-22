/**
 * RED+GREEN tests for the normalizeCatalog function (tasks 4.1–4.5 + 3.2–3.4).
 * Design §5 — normalizer pipeline.
 * References: graph-normalization spec scenarios, US-006, US-007, US-003, ADR-008, US-008.
 *
 * Golden files live at test/golden/normalize/<fixture>.json (NormalizationResult).
 * Determinism assertion: same input → byte-identical JSON output.
 *
 * Tasks 3.2–3.4 (Batch 3): gated hook tests (gate-ON + Mongo auto-trigger + gate-OFF byte-identical).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCatalog } from '../../../src/core/normalize/normalize.js';
import { nodeId } from '../../../src/core/normalize/id.js';
import type { RawCatalog } from '../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../src/core/model/graph.js';
import { NormalizationError } from '../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dirname, '../../fixtures');
const GOLDEN_DIR = join(import.meta.dirname, '../../golden/normalize');

function loadFixture(name: string): RawCatalog {
  const raw = readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as RawCatalog;
}

function serializeResult(result: NormalizationResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Loads the golden file if it exists, or writes it if it does not (bootstrap mode).
 * When the golden exists, the test asserts byte-identity.
 */
function assertMatchesGolden(name: string, result: NormalizationResult): void {
  const goldenPath = join(GOLDEN_DIR, `${name}.json`);
  const actual = serializeResult(result);
  if (!existsSync(goldenPath)) {
    writeFileSync(goldenPath, actual, 'utf8');
    // First run writes golden; subsequent runs compare.
    return;
  }
  const expected = readFileSync(goldenPath, 'utf8');
  expect(actual).toBe(expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full scope (everything at 'full' level) — default for most tests
// ─────────────────────────────────────────────────────────────────────────────
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
    collections: 'full',
    fields: 'full',
    statistics: 'off',
    sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4.1 — Minimal fixture normalizes to the golden graph (US-006 AC #1)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — catalog-minimal', () => {
  const raw = loadFixture('catalog-minimal');
  const result = normalizeCatalog(raw, FULL_SCOPE);

  it('returns a result with graph, stubs, and warnings', () => {
    expect(result).toHaveProperty('graph');
    expect(result).toHaveProperty('stubs');
    expect(result).toHaveProperty('warnings');
  });

  it('produces table nodes for orders and customers', () => {
    const kinds = result.graph.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'table')).toHaveLength(2);
    const qnames = result.graph.nodes.map((n) => n.qname);
    expect(qnames).toContain('dbo.orders');
    expect(qnames).toContain('dbo.customers');
  });

  it('produces a view node for vw_orders_summary', () => {
    const view = result.graph.nodes.find((n) => n.kind === 'view');
    expect(view?.qname).toBe('dbo.vw_orders_summary');
  });

  it('produces a trigger node for trg_orders_after_insert', () => {
    const trigger = result.graph.nodes.find((n) => n.kind === 'trigger');
    expect(trigger?.qname).toBe('dbo.trg_orders_after_insert');
  });

  it('produces a references edge (FK orders→customers)', () => {
    const refs = result.graph.edges.filter((e) => e.kind === 'references');
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it('produces a depends_on edge from view to orders table', () => {
    const depEdges = result.graph.edges.filter((e) => e.kind === 'depends_on');
    expect(depEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('produces a fires_on edge from trigger to orders', () => {
    const firesOn = result.graph.edges.filter((e) => e.kind === 'fires_on');
    expect(firesOn.length).toBeGreaterThanOrEqual(1);
    expect(firesOn[0]?.attrs.event).toBe('INSERT');
  });

  it('no stubs (all objects present)', () => {
    expect(result.stubs).toHaveLength(0);
  });

  it('matches the golden file (byte-identical deterministic output)', () => {
    assertMatchesGolden('catalog-minimal', result);
    // Re-run to prove determinism
    const result2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(result2)).toBe(serializeResult(result));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 — Composite FK: per-pair edges + 1 aggregated table→table (US-006 AC #2)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — catalog-composite-fk', () => {
  const raw = loadFixture('catalog-composite-fk');
  const result = normalizeCatalog(raw, FULL_SCOPE);

  it('emits exactly two per-column references edges (one per column pair)', () => {
    const perColumn = result.graph.edges.filter(
      (e) => e.kind === 'references' && e.attrs.aggregate !== true,
    );
    expect(perColumn).toHaveLength(2);
  });

  it('each per-column edge has srcColumn and dstColumn', () => {
    const perColumn = result.graph.edges.filter(
      (e) => e.kind === 'references' && e.attrs.aggregate !== true,
    );
    for (const edge of perColumn) {
      expect(edge.attrs.srcColumn).toBeTruthy();
      expect(edge.attrs.dstColumn).toBeTruthy();
    }
  });

  it('emits exactly one aggregated table→table references edge', () => {
    const agg = result.graph.edges.filter(
      (e) => e.kind === 'references' && e.attrs.aggregate === true,
    );
    expect(agg).toHaveLength(1);
  });

  it('aggregated edge carries constraintName', () => {
    const agg = result.graph.edges.find(
      (e) => e.kind === 'references' && e.attrs.aggregate === true,
    );
    expect(agg?.attrs.constraintName).toBeTruthy();
  });

  it('aggregated edge has confidence: declared', () => {
    const agg = result.graph.edges.find(
      (e) => e.kind === 'references' && e.attrs.aggregate === true,
    );
    expect(agg?.confidence).toBe('declared');
  });

  it('matches the golden file', () => {
    assertMatchesGolden('catalog-composite-fk', result);
    const result2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(result2)).toBe(serializeResult(result));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.3a — Stubs: missing:true (dangling reference — catalog-dangling-ref)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — catalog-dangling-ref (missing stubs)', () => {
  const raw = loadFixture('catalog-dangling-ref');
  const result = normalizeCatalog(raw, FULL_SCOPE);

  it('normalization succeeds (no throw)', () => {
    expect(result).toBeDefined();
  });

  it('creates a stub node with missing:true for dropped_table', () => {
    const stub = result.graph.nodes.find((n) => n.missing === true);
    expect(stub).toBeDefined();
    expect(stub?.qname).toContain('dropped_table');
  });

  it('reports the stub in result.stubs', () => {
    expect(result.stubs.length).toBeGreaterThanOrEqual(1);
    expect(result.stubs[0]?.reason).toBe('missing');
  });

  it('stub has referencedBy pointing to the view node', () => {
    const stubInfo = result.stubs[0];
    expect(stubInfo?.referencedBy).toBeTruthy();
    const refNode = result.graph.nodes.find((n) => n.id === stubInfo?.referencedBy);
    expect(refNode?.kind).toBe('view');
  });

  it('edge from view to stub is preserved', () => {
    const stub = result.graph.nodes.find((n) => n.missing === true);
    const edge = result.graph.edges.find((e) => e.dst === stub?.id);
    expect(edge).toBeDefined();
  });

  it('matches the golden file', () => {
    assertMatchesGolden('catalog-dangling-ref', result);
    const result2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(result2)).toBe(serializeResult(result));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.3b — Stubs: excluded:true (filtered target — catalog-excluded)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — catalog-excluded (excluded stubs)', () => {
  // Scope excludes the audit.log table
  const excludedScope: ExtractionScope = {
    ...FULL_SCOPE,
    exclude: ['audit.*'],
  };
  const raw = loadFixture('catalog-excluded');
  const result = normalizeCatalog(raw, excludedScope);

  it('normalization succeeds', () => {
    expect(result).toBeDefined();
  });

  it('creates a stub node with excluded:true for audit.log', () => {
    const stub = result.graph.nodes.find((n) => n.excluded === true);
    expect(stub).toBeDefined();
    expect(stub?.qname).toContain('audit.log');
  });

  it('reports the stub in result.stubs with reason excluded', () => {
    const stubInfo = result.stubs.find((s) => s.reason === 'excluded');
    expect(stubInfo).toBeDefined();
  });

  it('FK references edge to excluded stub is preserved', () => {
    const stub = result.graph.nodes.find((n) => n.excluded === true);
    const edge = result.graph.edges.find(
      (e) => e.kind === 'references' && e.dst === stub?.id,
    );
    expect(edge).toBeDefined();
  });

  it('matches the golden file', () => {
    assertMatchesGolden('catalog-excluded', result);
    const result2 = normalizeCatalog(raw, excludedScope);
    expect(serializeResult(result2)).toBe(serializeResult(result));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.4 — reads/writes + dynamic-SQL flag (catalog-rw-edges, US-007)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — catalog-rw-edges (reads_from/writes_to/hasDynamicSql)', () => {
  const raw = loadFixture('catalog-rw-edges');
  const result = normalizeCatalog(raw, FULL_SCOPE);

  it('produces reads_from edge from sp_transfer to transactions (confidence: parsed)', () => {
    const edge = result.graph.edges.find(
      (e) =>
        e.kind === 'reads_from' &&
        (() => {
          const src = result.graph.nodes.find((n) => n.id === e.src);
          const dst = result.graph.nodes.find((n) => n.id === e.dst);
          return src?.qname === 'dbo.sp_transfer' && dst?.qname === 'dbo.transactions';
        })(),
    );
    expect(edge).toBeDefined();
    expect(edge?.confidence).toBe('parsed');
  });

  it('produces writes_to edge from sp_transfer to accounts (confidence: parsed)', () => {
    const edge = result.graph.edges.find(
      (e) =>
        e.kind === 'writes_to' &&
        (() => {
          const src = result.graph.nodes.find((n) => n.id === e.src);
          const dst = result.graph.nodes.find((n) => n.id === e.dst);
          return src?.qname === 'dbo.sp_transfer' && dst?.qname === 'dbo.accounts';
        })(),
    );
    expect(edge).toBeDefined();
    expect(edge?.confidence).toBe('parsed');
  });

  it('sp_dynamic_report node has hasDynamicSql: true in payload', () => {
    const node = result.graph.nodes.find((n) => n.qname === 'dbo.sp_dynamic_report');
    expect(node?.payload['hasDynamicSql']).toBe(true);
  });

  it('sp_transfer node has hasDynamicSql: false in payload', () => {
    const node = result.graph.nodes.find((n) => n.qname === 'dbo.sp_transfer');
    expect(node?.payload['hasDynamicSql']).toBe(false);
  });

  it('matches the golden file', () => {
    assertMatchesGolden('catalog-rw-edges', result);
    const result2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(result2)).toBe(serializeResult(result));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.5 — Determinism: normalize twice → byte-identical (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — determinism (ADR-008)', () => {
  it('produces byte-identical output for catalog-minimal across runs', () => {
    const raw = loadFixture('catalog-minimal');
    const r1 = normalizeCatalog(raw, FULL_SCOPE);
    const r2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(r2)).toBe(serializeResult(r1));
  });

  it('produces byte-identical output for catalog-composite-fk across runs', () => {
    const raw = loadFixture('catalog-composite-fk');
    const r1 = normalizeCatalog(raw, FULL_SCOPE);
    const r2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(r2)).toBe(serializeResult(r1));
  });

  it('produces byte-identical output for catalog-rw-edges across runs', () => {
    const raw = loadFixture('catalog-rw-edges');
    const r1 = normalizeCatalog(raw, FULL_SCOPE);
    const r2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(r2)).toBe(serializeResult(r1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input validation (NormalizationError)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — input validation', () => {
  it('throws NormalizationError when engine is empty', () => {
    const raw: RawCatalog = { engine: '', schemas: [], objects: [] };
    expect(() => normalizeCatalog(raw, FULL_SCOPE)).toThrow(NormalizationError);
  });

  it('throws NormalizationError when FK columns are misaligned', () => {
    const raw: RawCatalog = {
      engine: 'mssql',
      schemas: ['dbo'],
      objects: [
        {
          kind: 'table',
          schema: 'dbo',
          name: 'bad_table',
          constraints: [
            {
              name: 'FK_bad',
              type: 'FK',
              columns: ['a', 'b'],
              references: { schema: 'dbo', table: 'other', columns: ['x'] }, // 2 src, 1 dst
            },
          ],
        },
      ],
    };
    expect(() => normalizeCatalog(raw, FULL_SCOPE)).toThrow(NormalizationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 — task 3.2: Gate ON (inferRelationships: true) surfaces inferred edges
// Design D3: gate = scope.inferRelationships === true OR collection/field nodes present.
// Spec: "Gate ON surfaces inferred edges".
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — inference gate ON (task 3.2, US-008)', () => {
  const raw = loadFixture('catalog-infer-gate');

  const INFER_ON_SCOPE: ExtractionScope = {
    levels: {
      tables: 'full',
      columns: 'full',
      constraints: 'full',
      indexes: 'full',
      views: 'full',
      procedures: 'metadata',
      functions: 'metadata',
      triggers: 'full',
      sequences: 'metadata',
      collections: 'full',
      fields: 'full',
      statistics: 'off',
      sampling: 'off',
    },
    inferRelationships: true,
  };

  const INFER_OFF_SCOPE: ExtractionScope = {
    levels: INFER_ON_SCOPE.levels,
    // inferRelationships absent → undefined → gate OFF
  };

  it('gate ON: emits exactly one inferred_reference edge from orders.customer_id to customers.id', () => {
    const result = normalizeCatalog(raw, INFER_ON_SCOPE);
    const inferred = result.graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(inferred).toHaveLength(1);
    const edge = inferred[0]!;
    // Exact endpoints (EXACT-set / L-009)
    expect(edge.src).toBe(nodeId('column', 'dbo.orders.customer_id'));
    expect(edge.dst).toBe(nodeId('column', 'dbo.customers.id'));
    expect(edge.attrs.srcColumn).toBe('customer_id');
    expect(edge.attrs.dstColumn).toBe('id');
    expect(edge.score).toBe(1.0);
    expect(edge.confidence).toBe('inferred');
  });

  it('gate OFF (flag absent): NO inferred_reference edge emitted', () => {
    const result = normalizeCatalog(raw, INFER_OFF_SCOPE);
    const inferred = result.graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(inferred).toHaveLength(0);
  });

  it('gate ON produces an edge that was ABSENT with gate OFF', () => {
    const offResult = normalizeCatalog(raw, INFER_OFF_SCOPE);
    const onResult = normalizeCatalog(raw, INFER_ON_SCOPE);
    const offInferred = offResult.graph.edges.filter((e) => e.kind === 'inferred_reference');
    const onInferred = onResult.graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(offInferred).toHaveLength(0);
    expect(onInferred.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 — task 3.3: Gate ON via Mongo auto-trigger (no inferRelationships flag)
// Design D3 secondary auto-trigger: if nodeMap contains collection/field nodes,
// inference fires even without the flag.
// Spec: "the documented secondary auto-trigger emits inference when collection/field nodes present".
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — inference auto-trigger via Mongo collection nodes (task 3.3, US-008)', () => {
  const raw = loadFixture('catalog-infer-mongo');

  // Scope has NO inferRelationships flag — secondary auto-trigger must fire
  const MONGO_SCOPE: ExtractionScope = {
    levels: {
      tables: 'full',
      columns: 'full',
      constraints: 'full',
      indexes: 'full',
      views: 'full',
      procedures: 'metadata',
      functions: 'metadata',
      triggers: 'full',
      sequences: 'metadata',
      collections: 'full',
      fields: 'full',
      statistics: 'off',
      sampling: 'off',
    },
    // inferRelationships NOT set → auto-trigger must fire due to collection nodes
  };

  it('normalizes successfully (no throw)', () => {
    const result = normalizeCatalog(raw, MONGO_SCOPE);
    expect(result).toBeDefined();
  });

  it('auto-trigger: emits at least one inferred_reference edge (collection nodes present)', () => {
    const result = normalizeCatalog(raw, MONGO_SCOPE);
    const inferred = result.graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(inferred.length).toBeGreaterThanOrEqual(1);
  });

  it('auto-trigger: the inferred edge connects orders.customer_id to customers._id (ObjectId compat)', () => {
    const result = normalizeCatalog(raw, MONGO_SCOPE);
    const inferred = result.graph.edges.filter((e) => e.kind === 'inferred_reference');
    // Exact COLUMN→COLUMN endpoints using nodeId (EXACT-set / L-009)
    // The normalizer builds `column` nodes from collection.columns (kind:'column' always)
    const srcId = nodeId('column', 'orders.customer_id');
    const dstId = nodeId('column', 'customers._id');
    const edge = inferred.find((e) => e.src === srcId && e.dst === dstId);
    expect(edge).toBeDefined();
    expect(edge!.attrs.srcColumn).toBe('customer_id');
    expect(edge!.attrs.dstColumn).toBe('_id');
    expect(edge!.confidence).toBe('inferred');
    expect(typeof edge!.score).toBe('number');
    expect(edge!.score).toBe(1.0); // conv=1.0 + typeCompat=1 + isPk=1 = 1.0
  });

  it('auto-trigger fires even though inferRelationships is absent (undefined !== true)', () => {
    expect(MONGO_SCOPE.inferRelationships).toBeUndefined();
    const result = normalizeCatalog(raw, MONGO_SCOPE);
    const inferred = result.graph.edges.filter((e) => e.kind === 'inferred_reference');
    // The secondary trigger (collection nodes present) MUST have fired
    expect(inferred.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 — task 3.4: Gate OFF on SQL fixture — BYTE-IDENTICAL to committed golden
// This is the LOAD-BEARING check: proves the hook did NOT leak onto the OFF path.
// Spec: "Gate OFF on an SQL fixture is byte-identical to its golden".
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — gate OFF byte-identical golden (task 3.4, US-008)', () => {
  it('gate OFF: catalog-minimal with inferRelationships unset produces NO inferred_reference edges', () => {
    const raw = loadFixture('catalog-minimal');
    // FULL_SCOPE has no inferRelationships and catalog-minimal has no collection/field nodes
    const result = normalizeCatalog(raw, FULL_SCOPE);
    const inferred = result.graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(inferred).toHaveLength(0);
  });

  it('gate OFF: catalog-minimal output is BYTE-IDENTICAL to committed golden', () => {
    const raw = loadFixture('catalog-minimal');
    const result = normalizeCatalog(raw, FULL_SCOPE);
    // Must match the COMMITTED golden exactly — do NOT re-seed if it exists
    assertMatchesGolden('catalog-minimal', result);
  });

  it('gate OFF: catalog-composite-fk output is BYTE-IDENTICAL to committed golden', () => {
    const raw = loadFixture('catalog-composite-fk');
    const result = normalizeCatalog(raw, FULL_SCOPE);
    assertMatchesGolden('catalog-composite-fk', result);
  });

  it('gate OFF: catalog-dangling-ref output is BYTE-IDENTICAL to committed golden', () => {
    const raw = loadFixture('catalog-dangling-ref');
    const result = normalizeCatalog(raw, FULL_SCOPE);
    assertMatchesGolden('catalog-dangling-ref', result);
  });

  it('gate OFF: catalog-excluded output is BYTE-IDENTICAL to committed golden', () => {
    const raw = loadFixture('catalog-excluded');
    const result = normalizeCatalog(raw, {
      ...FULL_SCOPE,
      exclude: ['audit.*'],
    });
    assertMatchesGolden('catalog-excluded', result);
  });

  it('gate OFF: catalog-rw-edges output is BYTE-IDENTICAL to committed golden', () => {
    const raw = loadFixture('catalog-rw-edges');
    const result = normalizeCatalog(raw, FULL_SCOPE);
    assertMatchesGolden('catalog-rw-edges', result);
  });
});
