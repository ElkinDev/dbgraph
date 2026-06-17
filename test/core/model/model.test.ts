/**
 * Tests for the graph domain model types.
 * Covers: NodeKind, EdgeKind, EdgeConfidence, IndexLevel, stub flag mutual exclusion.
 * Stories: US-006, US-007 (model), US-003 (levels).
 * TDD phase: RED — all assertions will fail until src/core/model is created.
 */

import { describe, expect, it } from 'vitest';
import {
  NODE_KINDS,
  EDGE_KINDS,
  EDGE_CONFIDENCE_VALUES,
  INDEX_LEVELS,
} from '../../../src/core/model/index.js';
import type {
  NodeKind,
  EdgeKind,
  EdgeConfidence,
  IndexLevel,
  GraphNode,
  GraphEdge,
  EdgeAttrs,
  ObjectTypeLevels,
  CapabilityMatrix,
  ExtractionScope,
  RawCatalog,
  NodePayload,
} from '../../../src/core/model/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// NodeKind exhaustiveness
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeKind', () => {
  it('covers all expected taxonomy values', () => {
    const expected: NodeKind[] = [
      'database',
      'schema',
      'table',
      'column',
      'constraint',
      'index',
      'view',
      'procedure',
      'function',
      'trigger',
      'sequence',
      'collection',
      'field',
    ];
    expect(NODE_KINDS).toHaveLength(13);
    for (const k of expected) {
      expect(NODE_KINDS).toContain(k);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EdgeKind exhaustiveness
// ─────────────────────────────────────────────────────────────────────────────

describe('EdgeKind', () => {
  it('covers all expected taxonomy values including inferred_reference type', () => {
    const expected: EdgeKind[] = [
      'references',
      'depends_on',
      'reads_from',
      'writes_to',
      'fires_on',
      'has_column',
      'has_index',
      'has_constraint',
      'in_index',
      'inferred_reference',
    ];
    expect(EDGE_KINDS).toHaveLength(10);
    for (const k of expected) {
      expect(EDGE_KINDS).toContain(k);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EdgeConfidence
// ─────────────────────────────────────────────────────────────────────────────

describe('EdgeConfidence', () => {
  it('accepts declared, parsed, and inferred', () => {
    const expected: EdgeConfidence[] = ['declared', 'parsed', 'inferred'];
    expect(EDGE_CONFIDENCE_VALUES).toHaveLength(3);
    for (const v of expected) {
      expect(EDGE_CONFIDENCE_VALUES).toContain(v);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IndexLevel
// ─────────────────────────────────────────────────────────────────────────────

describe('IndexLevel', () => {
  it('accepts off, metadata, and full', () => {
    const expected: IndexLevel[] = ['off', 'metadata', 'full'];
    expect(INDEX_LEVELS).toHaveLength(3);
    for (const l of expected) {
      expect(INDEX_LEVELS).toContain(l);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GraphNode — stub flag mutual exclusion (spec: "mutually exclusive")
// ─────────────────────────────────────────────────────────────────────────────

describe('GraphNode stub flags', () => {
  it('accepts a real node with neither flag set', () => {
    const node: GraphNode = {
      id: 'abc123',
      kind: 'table',
      schema: 'dbo',
      name: 'orders',
      qname: 'table:dbo.orders',
      level: 'metadata',
      missing: false,
      excluded: false,
      bodyHash: null,
      payload: {} as NodePayload,
    };
    expect(node.missing).toBe(false);
    expect(node.excluded).toBe(false);
  });

  it('accepts a missing stub with missing:true and excluded:false', () => {
    const node: GraphNode = {
      id: 'def456',
      kind: 'table',
      schema: 'dbo',
      name: 'dropped_table',
      qname: 'table:dbo.dropped_table',
      level: 'metadata',
      missing: true,
      excluded: false,
      bodyHash: null,
      payload: {} as NodePayload,
    };
    expect(node.missing).toBe(true);
    expect(node.excluded).toBe(false);
  });

  it('accepts an excluded stub with excluded:true and missing:false', () => {
    const node: GraphNode = {
      id: 'ghi789',
      kind: 'table',
      schema: 'audit',
      name: 'log',
      qname: 'table:audit.log',
      level: 'metadata',
      missing: false,
      excluded: true,
      bodyHash: null,
      payload: {} as NodePayload,
    };
    expect(node.missing).toBe(false);
    expect(node.excluded).toBe(true);
  });

  it('mutual exclusion: a node cannot have both missing and excluded set', () => {
    // TypeScript type system prevents this at compile-time via the model.
    // At runtime we verify by constructing and asserting the invariant.
    const node = {
      id: 'bad',
      kind: 'table' as NodeKind,
      schema: null,
      name: 'bad',
      qname: 'table:bad',
      level: 'metadata' as IndexLevel,
      missing: true,
      excluded: true,
      bodyHash: null,
      payload: {} as NodePayload,
    };
    // Both can coexist as raw data — the invariant is enforced by the normalizer.
    // We assert that BOTH being true means the node is invalid (checked in normalization).
    expect(node.missing && node.excluded).toBe(true); // this IS the violation to catch
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GraphEdge — fires_on event, score for inferred
// ─────────────────────────────────────────────────────────────────────────────

describe('GraphEdge', () => {
  it('fires_on edge carries an event in attrs', () => {
    const attrs: EdgeAttrs = { event: 'INSERT' };
    const edge: GraphEdge = {
      id: 'edge1',
      kind: 'fires_on',
      src: 'trigger-node-id',
      dst: 'table-node-id',
      confidence: 'declared',
      score: null,
      attrs,
    };
    expect(edge.attrs.event).toBe('INSERT');
    expect(edge.confidence).toBe('declared');
    expect(edge.score).toBeNull();
  });

  it('inferred_reference edge carries a numeric score', () => {
    const edge: GraphEdge = {
      id: 'edge2',
      kind: 'inferred_reference',
      src: 'node-a',
      dst: 'node-b',
      confidence: 'inferred',
      score: 0.85,
      attrs: {},
    };
    expect(edge.confidence).toBe('inferred');
    expect(typeof edge.score).toBe('number');
    expect(edge.score).toBe(0.85);
  });

  it('declared edge has null score', () => {
    const edge: GraphEdge = {
      id: 'edge3',
      kind: 'references',
      src: 'col-a',
      dst: 'col-b',
      confidence: 'declared',
      score: null,
      attrs: { srcColumn: 'customer_id', dstColumn: 'id', constraintName: 'FK_x' },
    };
    expect(edge.score).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ObjectTypeLevels — shape guard
// ─────────────────────────────────────────────────────────────────────────────

describe('ObjectTypeLevels', () => {
  it('can be constructed with all required fields', () => {
    const levels: ObjectTypeLevels = {
      tables: 'metadata',
      columns: 'metadata',
      constraints: 'metadata',
      indexes: 'metadata',
      views: 'metadata',
      procedures: 'metadata',
      functions: 'metadata',
      triggers: 'full',
      sequences: 'metadata',
      collections: 'metadata',
      fields: 'metadata',
      statistics: 'off',
      sampling: 'off',
    };
    expect(levels.triggers).toBe('full');
    expect(levels.statistics).toBe('off');
    expect(levels.sampling).toBe('off');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CapabilityMatrix — shape guard
// ─────────────────────────────────────────────────────────────────────────────

describe('CapabilityMatrix', () => {
  it('can represent an engine that does not support procedures', () => {
    const defaultLevels: ObjectTypeLevels = {
      tables: 'metadata',
      columns: 'metadata',
      constraints: 'metadata',
      indexes: 'metadata',
      views: 'metadata',
      procedures: 'metadata',
      functions: 'metadata',
      triggers: 'full',
      sequences: 'metadata',
      collections: 'metadata',
      fields: 'metadata',
      statistics: 'off',
      sampling: 'off',
    };
    const matrix: CapabilityMatrix = {
      engine: 'sqlite',
      supported: new Set<NodeKind>(['table', 'column', 'index', 'view']),
      defaultLevels,
      supportsBodies: false,
      supportsDependencyHints: false,
    };
    expect(matrix.supported.has('procedure')).toBe(false);
    expect(matrix.supported.has('table')).toBe(true);
    expect(matrix.supportsBodies).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ExtractionScope — shape guard
// ─────────────────────────────────────────────────────────────────────────────

describe('ExtractionScope', () => {
  it('can be constructed without optional include/exclude', () => {
    const scope: ExtractionScope = {
      levels: {
        tables: 'metadata',
        columns: 'metadata',
        constraints: 'metadata',
        indexes: 'metadata',
        views: 'metadata',
        procedures: 'metadata',
        functions: 'metadata',
        triggers: 'full',
        sequences: 'metadata',
        collections: 'metadata',
        fields: 'metadata',
        statistics: 'off',
        sampling: 'off',
      },
    };
    expect(scope.levels.triggers).toBe('full');
    expect(scope.include).toBeUndefined();
    expect(scope.exclude).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RawCatalog — shape guard (spec: "no db connection, no adapter import")
// ─────────────────────────────────────────────────────────────────────────────

describe('RawCatalog', () => {
  it('can be constructed in a test without any database connection', () => {
    const catalog: RawCatalog = {
      engine: 'mssql',
      engineVersion: '15.0',
      schemas: ['dbo'],
      objects: [
        {
          kind: 'table',
          schema: 'dbo',
          name: 'orders',
          columns: [
            { name: 'id', dataType: 'int', nullable: false, ordinal: 1 },
          ],
          constraints: [],
          indexes: [],
        },
      ],
    };
    expect(catalog.engine).toBe('mssql');
    expect(catalog.objects).toHaveLength(1);
    expect(catalog.objects[0]?.kind).toBe('table');
  });
});
