/**
 * Viz public barrel — change graph-viz, task 1.7.
 *
 * The ONLY public entry point for the pure `src/core/viz/**` module. Downstream layers
 * (the CLI `viz` command in Batch 3) import these through `src/index.ts`, never from the
 * internal sub-modules (collapse / community / neighbor-index).
 *
 * ADR-004: imports NOTHING from adapters, drivers, mcp, or cli. ADR-008: everything
 * exported here is pure + byte-deterministic.
 */

export { buildVizData } from './graph-data.js';
export { emitMermaidER } from './mermaid.js';

export type {
  VizOptions,
  VizNode,
  VizEdge,
  VizGraphData,
  CommunityInfo,
} from './types.js';
