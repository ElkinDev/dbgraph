/**
 * DOG-1 A.1 — model-level pins for the `calls` edge kind.
 * Strict TDD RED: `calls` is not yet in the EdgeKind union / EDGE_KINDS tuple.
 *
 * Spec: graph-model "calls edge connects two routine nodes" (S1) — model half:
 *   - `calls` is a member of the edge taxonomy.
 *   - a `calls` edge carries confidence ∈ {declared, parsed}, NEVER inferred, and NO score.
 * The endpoint-are-routine-nodes half is pinned in normalize (A.2/A.7).
 *
 * RESOLVED tuple placement: `calls` is inserted immediately AFTER `depends_on`.
 */

import { describe, it, expect } from 'vitest';
import { EDGE_KINDS } from '../../../src/core/model/edge.js';
import type { EdgeKind, GraphEdge, EdgeConfidence } from '../../../src/core/model/edge.js';

describe('EDGE_KINDS — calls edge kind is part of the taxonomy', () => {
  it('contains calls', () => {
    expect(EDGE_KINDS).toContain('calls' as EdgeKind);
  });

  it('places calls immediately after depends_on (RESOLVED slot)', () => {
    const dependsOnIdx = EDGE_KINDS.indexOf('depends_on');
    const callsIdx = EDGE_KINDS.indexOf('calls' as EdgeKind);
    expect(dependsOnIdx).toBeGreaterThanOrEqual(0);
    expect(callsIdx).toBe(dependsOnIdx + 1);
  });
});

describe('calls edge confidence — declared or parsed, never inferred, no score', () => {
  it('an mssql-style calls edge is declared with a null score', () => {
    const edge: GraphEdge = {
      id: 'e-mssql',
      kind: 'calls',
      src: 'proc-a',
      dst: 'proc-b',
      confidence: 'declared',
      score: null,
      attrs: {},
    };
    expect(edge.kind).toBe('calls');
    expect(edge.confidence).toBe('declared');
    expect(edge.score).toBeNull();
  });

  it('a pg/mysql-style calls edge is parsed with a null score', () => {
    const edge: GraphEdge = {
      id: 'e-pg',
      kind: 'calls',
      src: 'fn-a',
      dst: 'fn-b',
      confidence: 'parsed',
      score: null,
      attrs: {},
    };
    expect(edge.kind).toBe('calls');
    expect(edge.confidence).toBe('parsed');
    expect(edge.score).toBeNull();
  });

  it('the two provenance tiers a calls edge may carry are exactly declared and parsed', () => {
    const callsConfidences: readonly EdgeConfidence[] = ['declared', 'parsed'];
    expect(callsConfidences).not.toContain('inferred');
    // Every valid calls-edge confidence is a real EdgeConfidence value.
    for (const c of callsConfidences) {
      const edge: GraphEdge = {
        id: `e-${c}`,
        kind: 'calls',
        src: 'r-a',
        dst: 'r-b',
        confidence: c,
        score: null,
        attrs: {},
      };
      expect(edge.score).toBeNull();
    }
  });
});
