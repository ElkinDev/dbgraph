/**
 * filterReadersByColumn — the ONE shared column-precision helper (DOG-3 design D6).
 * Design §Interfaces/Contracts — PINNED conservative rule:
 *   dstColumns present + includes pivot -> affected (INCLUDE)
 *   dstColumns present + excludes pivot -> EXCLUDE (precision)
 *   dstColumns ABSENT                   -> INCLUDE (degrade = no false negative)
 *
 * Consumed by BOTH `core/query/impact.ts` (getImpact first-hop) and
 * `core/precheck/engine.ts` (via getImpact — no separate wiring needed there) so column-grain
 * precision and the degrade-by-absence guard live in exactly ONE place (bottleneck, tasks.md
 * "Dependency bottlenecks"). PURE, deterministic, no mutation of inputs.
 *
 * ADR-004: imports ONLY core model types. ADR-008: deterministic (same input -> same output).
 */

import type { GraphEdge } from '../model/edge.js';

/**
 * Filters a set of `depends_on` (or any) edges to those whose `attrs.dstColumns` either
 * includes `pivotCol` or is ABSENT entirely (degrade-by-absence, D4). An edge whose
 * `dstColumns` is present but EXCLUDES `pivotCol` is dropped — the deliberate precision
 * improvement (D6). Never mutates `edges` or any edge object.
 */
export function filterReadersByColumn(
  edges: readonly GraphEdge[],
  pivotCol: string,
): readonly GraphEdge[] {
  return edges.filter((e) => {
    const cols = e.attrs.dstColumns;
    if (cols === undefined) return true; // ABSENT -> INCLUDE (degrade, no false negative)
    return cols.includes(pivotCol); // PRESENT -> membership decides
  });
}
