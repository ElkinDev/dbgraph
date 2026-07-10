/**
 * DOG-1 A.3 — SQLite emits ZERO `calls` edges (the shared normalize branch must
 * fabricate NOTHING for an engine with no routine objects). D3.
 *
 * SQLite has no stored procedures or functions — its CapabilityMatrix declares both
 * UNSUPPORTED — so there is no routine node to be a `calls` source or destination, and
 * `resolveRoutineTarget` (Design D5) resolves any routine-kinded dependency to `null`,
 * emitting NO edge and NO stub. This pins the honest ABSENCE (mirrors the mongodb precedent).
 *
 * Spec: graph-model "SQLite emits no calls edge" (S5); sqlite-extraction (S27, S28).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import { createSqliteSchemaAdapter } from '../../../../src/adapters/engines/sqlite/factory.js';
import { SQLITE_CAPABILITIES } from '../../../../src/adapters/engines/sqlite/capabilities.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import type { RawCatalog } from '../../../../src/core/model/catalog.js';

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };

let mat: MaterializedDb;
let norm: NormalizationResult;

beforeAll(async () => {
  mat = materializeTorture();
  const adapter = await createSqliteSchemaAdapter({ file: mat.path });
  const catalog = await adapter.extract(FULL_SCOPE);
  await adapter.close();
  norm = normalizeCatalog(catalog, FULL_SCOPE);
});

afterAll(() => {
  mat.cleanup();
});

describe('SQLite torture graph — no calls edges (S5/S27)', () => {
  it('the normalized graph is non-trivial (the pipeline actually ran)', () => {
    // Guards against a trivially-empty GREEN: sqlite DOES produce dependency edges,
    // just never a `calls` one.
    expect(norm.graph.edges.length).toBeGreaterThan(0);
    const bodyEdges = norm.graph.edges.filter(
      (e) => e.kind === 'depends_on' || e.kind === 'writes_to',
    );
    expect(bodyEdges.length).toBeGreaterThan(0);
  });

  it('emits ZERO edges of kind calls', () => {
    expect(norm.graph.edges.filter((e) => e.kind === 'calls')).toStrictEqual([]);
  });

  it('there is NO procedure or function node (real or stub) to anchor a calls edge', () => {
    const routineNodes = norm.graph.nodes.filter(
      (n) => n.kind === 'procedure' || n.kind === 'function',
    );
    expect(routineNodes).toStrictEqual([]);
    const routineStubs = norm.stubs.filter(
      (s) => s.kind === 'procedure' || s.kind === 'function',
    );
    expect(routineStubs).toStrictEqual([]);
  });
});

describe('SQLite CapabilityMatrix — procedures and functions unsupported (S28)', () => {
  it('procedure is unsupported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('procedure')).toBe(false);
  });

  it('function is unsupported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('function')).toBe(false);
  });
});

describe('SQLite trigger naming a function-like token invents nothing (S27 negative)', () => {
  // Even if a routine-kinded dependency leaked into a sqlite catalog (it cannot today —
  // sqlite's tokenizer never assigns a routine kind), the shared A.2 branch must resolve it
  // to NO real routine node and therefore emit NO `calls` edge and mint NO stub.
  const catalog: RawCatalog = {
    engine: 'sqlite',
    schemas: ['main'],
    objects: [
      {
        kind: 'table',
        schema: 'main',
        name: 'employees',
        columns: [{ name: 'id', dataType: 'INTEGER', nullable: false, ordinal: 1 }],
        constraints: [],
        indexes: [],
      },
      {
        kind: 'trigger',
        schema: 'main',
        name: 'trg_calc',
        body: 'CREATE TRIGGER trg_calc AFTER INSERT ON employees BEGIN SELECT some_udf(NEW.id); END',
        trigger: { timing: 'AFTER', events: ['INSERT'], table: { schema: 'main', name: 'employees' } },
        dependencies: [
          { target: { schema: 'main', name: 'some_udf', kind: 'function' }, access: 'read', confidence: 'parsed' },
        ],
      },
    ],
  };
  const result = normalizeCatalog(catalog, FULL_SCOPE);

  it('emits ZERO calls edges for the function-like token', () => {
    expect(result.graph.edges.filter((e) => e.kind === 'calls')).toStrictEqual([]);
  });

  it('mints NO stub for some_udf (no routine stub, no table stub)', () => {
    expect(result.stubs.filter((s) => s.qname === 'main.some_udf')).toStrictEqual([]);
    expect(result.graph.nodes.find((n) => n.qname === 'main.some_udf')).toBeUndefined();
  });
});
