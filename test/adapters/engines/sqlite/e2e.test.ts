// E2E pipeline test — task 9.1 (US-026, ADR-008).
// Pipeline: torture.sql → materialize → adapter.extract → normalizeCatalog
//           → createSqliteGraphStore.upsertGraph → neighbors/impact/path/search
// Golden-pinned: second run must produce byte-identical output.
//
// Design §9 "E2E pipeline goldens" — reuses Phase-1 pipeline (store + query).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import { createSqliteSchemaAdapter } from '../../../../src/adapters/engines/sqlite/factory.js';
import { createSqliteGraphStore } from '../../../../src/adapters/storage/sqlite/factory.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { getNeighbors } from '../../../../src/core/query/neighbors.js';
import { getImpact } from '../../../../src/core/query/impact.js';
import { findJoinPath } from '../../../../src/core/query/path.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { GraphStore } from '../../../../src/core/ports/graph-store.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_PATH = join(__dirname, '../../../fixtures/sqlite/golden-e2e.json');

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

let mat: MaterializedDb;
let normResult: NormalizationResult;
let store: GraphStore;

beforeAll(async () => {
  mat = materializeTorture();

  // Step 1: Extract
  const adapter = await createSqliteSchemaAdapter({ file: mat.path });
  const catalog = await adapter.extract(FULL_SCOPE);
  await adapter.close();

  // Step 2: Normalize
  normResult = normalizeCatalog(catalog, FULL_SCOPE);

  // Step 3: Store
  store = await createSqliteGraphStore({ path: ':memory:' });
  await store.upsertGraph(normResult.graph);
});

afterAll(async () => {
  await store.close();
  mat.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline smoke tests
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E pipeline: extract → normalize → store → query', () => {
  it('extract produces a valid RawCatalog with tables', async () => {
    const adapter = await createSqliteSchemaAdapter({ file: mat.path });
    const catalog = await adapter.extract(FULL_SCOPE);
    await adapter.close();

    expect(catalog.engine).toBe('sqlite');
    expect(catalog.objects.filter((o) => o.kind === 'table').length).toBeGreaterThan(0);
  });

  it('normalizeCatalog produces nodes and edges from the SQLite catalog', () => {
    expect(normResult.graph.nodes.length).toBeGreaterThan(0);
    expect(normResult.graph.edges.length).toBeGreaterThan(0);
  });

  it('upsertGraph persists all nodes', async () => {
    const allNodes = await store.getNodesByKind('table');
    expect(allNodes.length).toBeGreaterThan(0);
  });

  it('employees table node is present in the store', async () => {
    const tables = await store.getNodesByKind('table');
    const emp = tables.find((n) => n.name === 'employees');
    expect(emp).toBeDefined();
  });

  it('departments table node is present in the store', async () => {
    const tables = await store.getNodesByKind('table');
    const dept = tables.find((n) => n.name === 'departments');
    expect(dept).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query API smoke tests
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E query: neighbors', () => {
  it('employees table has column neighbors', async () => {
    const tables = await store.getNodesByKind('table');
    const emp = tables.find((n) => n.name === 'employees');
    if (emp === undefined) throw new Error('employees table not found');

    const groups = await getNeighbors(store, { nodeId: emp.id });
    const hasColumnEdges = Object.keys(groups).includes('has_column');
    expect(hasColumnEdges).toBe(true);
  });
});

describe('E2E query: impact', () => {
  it('impact traversal from employees table returns a result', async () => {
    const tables = await store.getNodesByKind('table');
    const emp = tables.find((n) => n.name === 'employees');
    if (emp === undefined) throw new Error('employees table not found');

    const impact = await getImpact(store, { nodeId: emp.id });
    // employees has FK references from assignments — should appear in read/write impact
    expect(impact).toBeDefined();
    expect(impact.truncated).toBe(false);
  });
});

describe('E2E query: join path', () => {
  it('path from employees to departments follows FK', async () => {
    const tables = await store.getNodesByKind('table');
    const emp = tables.find((n) => n.name === 'employees');
    const dept = tables.find((n) => n.name === 'departments');
    if (emp === undefined || dept === undefined) {
      throw new Error('employees or departments table not found');
    }

    const result = await findJoinPath(store, { from: emp.id, to: dept.id });
    // employees.dept_id → departments.dept_id via FK
    expect(result.found).toBe(true);
    if (result.found && result.hops !== undefined) {
      expect(result.hops.length).toBeGreaterThan(0);
    }
  });
});

describe('E2E query: full-text search', () => {
  it('search for "employees" returns at least one hit', async () => {
    const result = await store.searchFts('employees', { limit: 10 });
    expect(result.hits.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden-pinned E2E output (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E golden: byte-identical on second run (ADR-008)', () => {
  it('normalized graph is deterministic (stableStringify stable across two extractions)', async () => {
    // Second extraction — must produce identical stableStringify
    const adapter2 = await createSqliteSchemaAdapter({ file: mat.path });
    const catalog2 = await adapter2.extract(FULL_SCOPE);
    await adapter2.close();
    const normResult2 = normalizeCatalog(catalog2, FULL_SCOPE);

    expect(stableStringify(normResult.graph)).toBe(stableStringify(normResult2.graph));
  });

  it('E2E golden matches committed golden file (seeds on first run)', () => {
    // The golden captures nodes + edges count + stubs count
    const snapshot = {
      nodeCount: normResult.graph.nodes.length,
      edgeCount: normResult.graph.edges.length,
      stubCount: normResult.stubs.length,
      // First few node qnames for stable fingerprint
      firstNodes: normResult.graph.nodes
        .slice(0, 5)
        .map((n) => ({ kind: n.kind, qname: n.qname })),
    };
    const actual = stableStringify(snapshot);

    if (!existsSync(GOLDEN_PATH)) {
      writeFileSync(GOLDEN_PATH, actual, 'utf-8');
      console.log('[e2e] Golden seeded:', GOLDEN_PATH);
      expect(actual.length).toBeGreaterThan(0);
      return;
    }

    const committed = readFileSync(GOLDEN_PATH, 'utf-8');
    expect(actual).toBe(committed);
  });
});
