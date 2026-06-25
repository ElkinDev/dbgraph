/**
 * infer-on-fields — inference fires automatically from collection/field node presence (task 5.5).
 * STRICT TDD: RED → GREEN
 *
 * Unit test (NO DB, NO driver): exercises the full normalizeCatalog pipeline
 * with a synthetic MongoDB-like RawCatalog containing:
 *   - orders (collection) with field customer_id (dataType:'objectId')
 *   - customers (collection) with field _id (dataType:'objectId')
 *
 * Asserts:
 *   - inferReferences fires AUTOMATICALLY (hasCollectionOrFieldNode auto-trigger)
 *   - Exactly ONE inferred_reference edge: orders.customer_id → customers._id
 *   - confidence: 'inferred', numeric score
 *   - _id itself yields no source entity (bare entity '_' → no matching collection)
 *   - No declared/parsed reference edge (RawCatalog carries none)
 *   - no self-edge, no phantom edges
 *   - EXACT endpoints by qname + toBe(1) count (L-009 — existence-only .toBeDefined() is FORBIDDEN)
 *
 * Spec: "orders.customer_id infers a reference to customers._id;
 *        inference fires automatically from the presence of a collection/field node."
 * Design D3 (auto-trigger), D1 (column→column / field→field endpoints).
 * US-030, ADR-004.
 */

import { describe, it, expect } from 'vitest';
import { normalizeCatalog } from '../../../src/core/normalize/normalize.js';
import { DEFAULT_LEVELS } from '../../../src/core/model/capability.js';
import type { RawCatalog } from '../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal MongoDB-like RawCatalog with two collections:
 *   - orders: field customer_id (dataType:'objectId')
 *   - customers: field _id (dataType:'objectId')
 *
 * No constraints, no references declared — inference fires from field node presence.
 */
const mongoRawCatalog: RawCatalog = {
  engine: 'mongodb',
  schemas: ['mydb'],
  objects: [
    {
      kind: 'collection',
      schema: 'mydb',
      name: 'orders',
      fields: [
        { name: 'customer_id', dataType: 'objectId', frequency: 1.0 },
      ],
    },
    {
      kind: 'collection',
      schema: 'mydb',
      name: 'customers',
      fields: [
        { name: '_id', dataType: 'objectId', frequency: 1.0 },
      ],
    },
  ],
};

/**
 * Scope with fields: 'full' so field nodes are built.
 * inferRelationships is NOT set (undefined) — inference fires via auto-trigger only.
 */
const mongoScope: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
    collections: 'full',
    fields: 'full',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('infer-on-fields — MongoDB auto-trigger inference (task 5.5)', () => {
  it('produces field nodes for orders.customer_id and customers._id', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const fieldNodes = graph.nodes.filter((n) => n.kind === 'field');
    expect(fieldNodes.length).toBe(2);

    const qnames = fieldNodes.map((n) => n.qname).sort();
    expect(qnames).toEqual(['mydb.customers._id', 'mydb.orders.customer_id']);
  });

  it('produces collection nodes for orders and customers', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const collNodes = graph.nodes.filter((n) => n.kind === 'collection');
    expect(collNodes.length).toBe(2);

    const qnames = collNodes.map((n) => n.qname).sort();
    expect(qnames).toEqual(['mydb.customers', 'mydb.orders']);
  });

  it('emits EXACTLY one inferred_reference edge (toBe(1) — no existence-only assertion)', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const inferredEdges = graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(inferredEdges.length).toBe(1);
  });

  it('inferred_reference edge has correct src endpoint (orders.customer_id)', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const [edge] = graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(edge).toBeDefined();

    // Resolve src node by ID — must be orders.customer_id
    const srcNode = graph.nodes.find((n) => n.id === edge!.src);
    expect(srcNode).toBeDefined();
    expect(srcNode!.qname).toBe('mydb.orders.customer_id');
    expect(srcNode!.kind).toBe('field');
  });

  it('inferred_reference edge has correct dst endpoint (customers._id)', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const [edge] = graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(edge).toBeDefined();

    // Resolve dst node by ID — must be customers._id
    const dstNode = graph.nodes.find((n) => n.id === edge!.dst);
    expect(dstNode).toBeDefined();
    expect(dstNode!.qname).toBe('mydb.customers._id');
    expect(dstNode!.kind).toBe('field');
  });

  it('inferred_reference edge has confidence "inferred"', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const [edge] = graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(edge).toBeDefined();
    expect(edge!.confidence).toBe('inferred');
  });

  it('inferred_reference edge has a numeric score (not null/undefined)', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const [edge] = graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(edge).toBeDefined();
    expect(typeof edge!.score).toBe('number');
    expect(edge!.score).toBeGreaterThan(0);
  });

  it('_id itself yields no source entity (bare entity "_" → no matching collection → no outgoing edge from _id)', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    // Find the _id field node
    const idNode = graph.nodes.find((n) => n.qname === 'mydb.customers._id');
    expect(idNode).toBeDefined();

    // No inferred_reference edge should have _id as src
    const outgoingFromId = graph.edges.filter(
      (e) => e.kind === 'inferred_reference' && e.src === idNode!.id,
    );
    expect(outgoingFromId.length).toBe(0);
  });

  it('no declared references edge exists (RawCatalog carries no constraints/refs)', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const declaredRefs = graph.edges.filter((e) => e.kind === 'references');
    expect(declaredRefs.length).toBe(0);
  });

  it('no self-edge (src !== dst on the inferred edge)', () => {
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const [edge] = graph.edges.filter((e) => e.kind === 'inferred_reference');
    expect(edge).toBeDefined();
    expect(edge!.src).not.toBe(edge!.dst);
  });

  it('inference fires WITHOUT scope.inferRelationships being set (auto-trigger from field nodes)', () => {
    // Confirm: scope has NO inferRelationships set, yet inference runs.
    expect(mongoScope.inferRelationships).toBeUndefined();
    const { graph } = normalizeCatalog(mongoRawCatalog, mongoScope);
    const inferredEdges = graph.edges.filter((e) => e.kind === 'inferred_reference');
    // Must have inferred edges despite inferRelationships being absent
    expect(inferredEdges.length).toBe(1);
  });
});
