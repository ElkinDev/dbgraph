/**
 * NormalizedGraph, NormalizationResult, OmittedKindInfo, and StubInfo.
 * Design §4.6 — the output contract of normalizeCatalog.
 * No adapter, driver, mcp, or cli imports (ADR-004).
 */

import type { GraphNode } from './node.js';
import type { GraphEdge } from './edge.js';
import type { NodeKind } from './node.js';

export interface NormalizedGraph {
  readonly nodes: readonly GraphNode[];   // deterministically ordered (design §5.6)
  readonly edges: readonly GraphEdge[];   // deterministically ordered (design §5.6)
}

export interface StubInfo {
  readonly id: string;
  readonly qname: string;
  readonly kind: NodeKind;
  readonly reason: 'missing' | 'excluded';
  readonly referencedBy: string;          // node id that forced the stub
}

/**
 * Records an object type that was omitted because its level is 'off' in the scope.
 * US-003 / graph-model spec "off level is an absence, not silence":
 * "a queryable absence reason is representable".
 */
export interface OmittedKindInfo {
  /** The object kind that was configured off. */
  readonly kind: NodeKind;
  /** Human-readable reason: always "not indexed by configuration" (US-003 spec wording). */
  readonly reason: string;
}

export interface NormalizationResult {
  readonly graph: NormalizedGraph;
  readonly stubs: readonly StubInfo[];            // US-006 AC #3 — reported, never silent
  readonly warnings: readonly string[];           // e.g. dropped duplicate, unknown ref kind
  /** US-003 / W-1: off-level kinds with queryable absence reason (spec: "not indexed by configuration"). */
  readonly omitted: readonly OmittedKindInfo[];
}
