/**
 * Public viz types — change graph-viz, Batch 1 (design §Interfaces / Contracts).
 *
 * ADR-004: this module imports ONLY core model types — NO adapters, NO cli, NO mcp,
 * NO drivers, NO I/O. ADR-008: the shapes below back a byte-deterministic data block.
 */

import type { NodeKind } from '../model/node.js';
import type { EdgeKind } from '../model/edge.js';

/**
 * Export-time shaping options for the viz graph.
 * - `full`      — render every kind incl. columns (heavy, explicit opt-in).
 * - `columns`   — include column nodes but no other heavy kinds (lighter than full).
 * - `schema`    — scope to one schema.
 * - `minDegree` — drop nodes below this incident-edge degree threshold.
 * - `kinds`     — explicit node-kind allowlist (overrides the tier keep-set).
 */
export interface VizOptions {
  readonly full: boolean;
  readonly columns?: boolean;
  readonly schema?: string;
  readonly minDegree?: number;
  readonly kinds?: readonly NodeKind[];
}

/** One community in the sidebar legend: stable id, dominant-prefix name, member count. */
export interface CommunityInfo {
  readonly id: number;
  readonly name: string;
  readonly count: number;
}

/** One node in the embedded data block. `detail` is `formatObject(view, 'full')` verbatim. */
export interface VizNode {
  readonly i: number;
  readonly label: string;
  readonly kind: NodeKind;
  readonly community: number;
  readonly degree: number;
  readonly detail: string;
}

/** One edge in the embedded data block, referencing node indices (`i`). */
export interface VizEdge {
  readonly s: number;
  readonly t: number;
  readonly kind: EdgeKind;
}

/** The full embedded data block — byte-deterministic under stable serialization. */
export interface VizGraphData {
  readonly nodes: readonly VizNode[];
  readonly edges: readonly VizEdge[];
  readonly communities: readonly CommunityInfo[];
}
