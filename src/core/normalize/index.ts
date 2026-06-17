/**
 * Normalize module barrel.
 * Design §2 — public surface for the normalize package.
 * This file imports NOTHING from adapters, drivers, mcp, or cli (ADR-004).
 */

export { normalizeCatalog } from './normalize.js';
export { nodeId, edgeId, canonicalQName, stableStringify } from './id.js';
export { applyLevel, normalizeBody } from './levels.js';
export type { LevelResult } from './levels.js';
