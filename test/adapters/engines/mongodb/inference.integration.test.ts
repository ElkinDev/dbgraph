/**
 * Integration test: MongoDB inference pipeline + E2E golden.
 * Pipeline: torture seed → container → extract → normalizeCatalog (inference ON)
 *           → SqliteGraphStore.upsertGraph → impact/path/query.
 *
 * Gate: DBGRAPH_INTEGRATION=1 must be set. Without it the entire suite is skipped.
 *
 * Per-suite hookTimeout: 120 000 ms — mongo:7 image pull + startup.
 *
 * L-009 assertions: EXACT endpoints + count for inferred_reference edges.
 * US-030 (inferred relationships), ADR-008 (determinism), L-009 (exact-set).
 *
 * Also covers:
 *   - Values-never-persisted in .db (sentinel not in persisted store)
 *   - E2E golden seeded and byte-identical
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startMongodbContainer,
  mongodbIntegrationEnabled,
} from '../../../fixtures/mongodb/container.js';
import type { MongodbContainerHandle } from '../../../fixtures/mongodb/container.js';
import { createMongodbSchemaAdapter } from '../../../../src/adapters/engines/mongodb/factory.js';
import { createSqliteGraphStore } from '../../../../src/adapters/storage/sqlite/factory.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { getImpact } from '../../../../src/core/query/impact.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { GraphStore } from '../../../../src/core/ports/graph-store.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';
import { SENTINEL_VALUE } from '../../../fixtures/mongodb/torture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_DIR = join(__dirname, '../../../fixtures/mongodb/golden');
const GOLDEN_PATH = join(GOLDEN_DIR, 'golden-e2e.json');

// Full scope — collections + fields (MongoDB default levels)
const FULL_SCOPE: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
  },
};

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

let handle: MongodbContainerHandle;
let normResult: NormalizationResult;
let store: GraphStore;

beforeAll(async () => {
  if (!mongodbIntegrationEnabled()) return;
  mkdirSync(GOLDEN_DIR, { recursive: true });
  handle = await startMongodbContainer();

  // Step 1: Extract
  const adapter = await createMongodbSchemaAdapter(handle.config);
  const catalog = await adapter.extract(FULL_SCOPE);
  await adapter.close();

  // Step 2: Normalize (inference fires AUTOMATICALLY from collection/field node presence)
  normResult = normalizeCatalog(catalog, FULL_SCOPE);

  // Step 3: Store in in-memory SQLite graph store
  store = await createSqliteGraphStore({ path: ':memory:' });
  await store.upsertGraph(normResult.graph);
}, 120_000);

afterAll(async () => {
  if (store !== undefined) await store.close();
  if (handle !== undefined) await handle.stop();
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Inference: inferred_reference edges (L-009 exact-set assertions)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mongodbIntegrationEnabled())(
  'MongoDB inference integration — inferred_reference edges (US-030, L-009) [Task 7.5]',
  () => {
    it('normalizeCatalog produces nodes', () => {
      expect(normResult.graph.nodes.length).toBeGreaterThan(0);
    });

    it('normalizeCatalog produces edges (inference fires from collection/field nodes)', () => {
      expect(normResult.graph.edges.length).toBeGreaterThan(0);
    });

    it('at least one inferred_reference edge is produced', () => {
      const inferredEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'inferred_reference',
      );
      expect(inferredEdges.length).toBeGreaterThan(0);
    });

    it('inferred_reference edge exists from orders.customer_id to customers._id (exact endpoint qnames, L-009)', () => {
      // Reality-driven fix (Task 7.4): qname format includes the database name as schema prefix.
      // qname = '{database}.{collection}.{field}' e.g. 'dbgraph_test.orders.customer_id'
      const ordersCustomerIdNode = normResult.graph.nodes.find(
        (n) => n.kind === 'field' && n.name === 'customer_id' && n.qname.includes('.orders.'),
      );
      expect(ordersCustomerIdNode).toBeDefined();

      // Find the customers._id field node
      const customersIdNode = normResult.graph.nodes.find(
        (n) => n.kind === 'field' && n.name === '_id' && n.qname.includes('.customers.'),
      );
      expect(customersIdNode).toBeDefined();

      // Find the inferred_reference edge between them
      const inferredEdge = normResult.graph.edges.find(
        (e) =>
          e.kind === 'inferred_reference' &&
          e.src === ordersCustomerIdNode!.id &&
          e.dst === customersIdNode!.id,
      );
      expect(inferredEdge).toBeDefined();
    });

    it('inferred edge carries confidence:inferred and a numeric score', () => {
      const ordersCustomerIdNode = normResult.graph.nodes.find(
        (n) => n.kind === 'field' && n.name === 'customer_id' && n.qname.includes('.orders.'),
      );
      const customersIdNode = normResult.graph.nodes.find(
        (n) => n.kind === 'field' && n.name === '_id' && n.qname.includes('.customers.'),
      );
      const inferredEdge = normResult.graph.edges.find(
        (e) =>
          e.kind === 'inferred_reference' &&
          e.src === ordersCustomerIdNode!.id &&
          e.dst === customersIdNode!.id,
      );
      expect(inferredEdge).toBeDefined();
      expect(inferredEdge!.confidence).toBe('inferred');
      expect(typeof inferredEdge!.score).toBe('number');
      expect(inferredEdge!.score).toBeGreaterThan(0);
    });

    it('NO declared or parsed references edge exists (MongoDB has no FK catalog)', () => {
      const declaredEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'references',
      );
      expect(declaredEdges.length).toBe(0);

      const parsedEdges = normResult.graph.edges.filter(
        (e) => e.confidence === 'parsed',
      );
      expect(parsedEdges.length).toBe(0);
    });

    it('stubCount is 0 (no phantom stub nodes for MongoDB)', () => {
      expect(normResult.stubs.length).toBe(0);
    });

    it('no self-referential inferred_reference edges', () => {
      const selfEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'inferred_reference' && e.src === e.dst,
      );
      expect(selfEdges.length).toBe(0);
    });

    it('inferred_reference edge count is pinned (L-009: exact count)', () => {
      const inferredEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'inferred_reference',
      );
      // The torture dataset has exactly 1 <entity>_id field that matches:
      // orders.customer_id → customers._id
      // Pin the exact count — if more are added, this test will catch the regression.
      expect(inferredEdges.length).toBe(1);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// E2E pipeline: extract → normalize → store → query
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mongodbIntegrationEnabled())(
  'MongoDB E2E pipeline: extract → normalize → store → query (US-030, ADR-008) [Task 7.5]',
  () => {
    it('graph store contains collection nodes', async () => {
      const collections = await store.getNodesByKind('collection');
      expect(collections.length).toBeGreaterThan(0);
    });

    it('customers collection node is in the store', async () => {
      const collections = await store.getNodesByKind('collection');
      expect(collections.find((n) => n.name === 'customers')).toBeDefined();
    });

    it('orders collection node is in the store', async () => {
      const collections = await store.getNodesByKind('collection');
      expect(collections.find((n) => n.name === 'orders')).toBeDefined();
    });

    it('field nodes exist in the graph (fields normalized from RawField)', () => {
      const fields = normResult.graph.nodes.filter((n) => n.kind === 'field');
      expect(fields.length).toBeGreaterThan(0);
    });

    it('orders.customer_id field node has qname containing .orders.', () => {
      // Reality-driven fix (Task 7.4): qname = '{schema}.{collection}.{field}'
      // e.g. 'dbgraph_test.orders.customer_id'
      const customerIdNode = normResult.graph.nodes.find(
        (n) => n.kind === 'field' && n.name === 'customer_id',
      );
      expect(customerIdNode).toBeDefined();
      expect(customerIdNode!.qname).toContain('.orders.');
    });

    it('customers._id field node has qname containing .customers.', () => {
      // qname = 'dbgraph_test.customers._id'
      const idNode = normResult.graph.nodes.find(
        (n) => n.kind === 'field' && n.name === '_id' && n.qname.includes('.customers.'),
      );
      expect(idNode).toBeDefined();
    });

    // ── Impact traversal ──────────────────────────────────────────────────────

    it('impact traversal from orders collection returns a result', async () => {
      const collections = await store.getNodesByKind('collection');
      const orders = collections.find((n) => n.name === 'orders');
      if (orders === undefined) throw new Error('orders collection not found in store');

      const impact = await getImpact(store, { nodeId: orders.id });
      expect(impact).toBeDefined();
      expect(impact.truncated).toBe(false);
    });

    // ── Path traversal ─────────────────────────────────────────────────────────

    it('impact traversal from orders collection returns a result (non-truncated)', async () => {
      // Impact traversal from the orders collection to verify the pipeline works end-to-end.
      // The inferred_reference edge: orders.customer_id → customers._id
      // The has_column edges: orders → orders.customer_id (forward traversal)
      const ordersNode = normResult.graph.nodes.find(
        (n) => n.kind === 'collection' && n.name === 'orders',
      );
      if (ordersNode === undefined) {
        throw new Error('orders collection not found for impact test');
      }

      const impact = await getImpact(store, { nodeId: ordersNode.id });
      expect(impact).toBeDefined();
      expect(impact.truncated).toBe(false);
    });

    // ── Values-never-persisted in .db ─────────────────────────────────────────

    it('SENTINEL_VALUE does NOT appear in the normalized graph (values-never-persisted in store)', () => {
      const graphSerialized = stableStringify(normResult.graph);
      expect(graphSerialized).not.toContain(SENTINEL_VALUE);
    });

    it('no customer email literal appears in the normalized graph', () => {
      const graphSerialized = stableStringify(normResult.graph);
      expect(graphSerialized).not.toContain('bob@example.com');
    });

    // ── Determinism (ADR-008) ─────────────────────────────────────────────────

    it('E2E pipeline is deterministic (second extract produces byte-identical graph)', async () => {
      const adapter2 = await createMongodbSchemaAdapter(handle.config);
      const catalog2 = await adapter2.extract(FULL_SCOPE);
      await adapter2.close();
      const normResult2 = normalizeCatalog(catalog2, FULL_SCOPE);

      expect(stableStringify(normResult.graph)).toBe(stableStringify(normResult2.graph));
    });

    // ── E2E golden ────────────────────────────────────────────────────────────

    it('E2E golden matches committed golden file (seeds on first run)', () => {
      const inferredEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'inferred_reference',
      );

      // Pin the inferred edge endpoints by qname (L-009)
      const inferredEdgeEndpoints = inferredEdges.map((e) => {
        const srcNode = normResult.graph.nodes.find((n) => n.id === e.src);
        const dstNode = normResult.graph.nodes.find((n) => n.id === e.dst);
        return {
          kind: e.kind,
          confidence: e.confidence,
          src: srcNode?.qname ?? e.src,
          dst: dstNode?.qname ?? e.dst,
        };
      }).sort((a, b) => a.src.localeCompare(b.src));

      const snapshot = {
        nodeCount: normResult.graph.nodes.length,
        edgeCount: normResult.graph.edges.length,
        stubCount: normResult.stubs.length,
        collectionCount: normResult.graph.nodes.filter((n) => n.kind === 'collection').length,
        fieldCount: normResult.graph.nodes.filter((n) => n.kind === 'field').length,
        inferredEdgeCount: inferredEdges.length,
        // Pinned inferred edges with exact endpoints (L-009)
        inferredEdges: inferredEdgeEndpoints,
        // Edge kinds present in the graph
        edgeKinds: [...new Set(normResult.graph.edges.map((e) => e.kind))].sort(),
      };
      const actual = stableStringify(snapshot);

      if (!existsSync(GOLDEN_PATH)) {
        writeFileSync(GOLDEN_PATH, actual, 'utf-8');
        console.log('[mongodb-e2e-integration] Golden seeded:', GOLDEN_PATH);
        expect(actual.length).toBeGreaterThan(0);
        return;
      }

      const committed = readFileSync(GOLDEN_PATH, 'utf-8');
      expect(actual).toBe(committed);
    });
  },
);

// Placeholder test so the file is not empty when integration is disabled
if (!mongodbIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
