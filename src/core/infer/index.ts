/**
 * Public surface of the structural inference engine.
 * Pure-core barrel — imports nothing outside src/core (ADR-004).
 * ADR-007: zero new npm dependencies.
 * US-008
 */

// ── Inference engine ─────────────────────────────────────────────────────────
export { inferReferences, W_CONVENTION, W_TYPE, W_PK_TARGET, THRESHOLD } from './infer-references.js';
export type { InferOptions } from './infer-references.js';

// ── Type-compat helpers ───────────────────────────────────────────────────────
export { typeFamily, compatible } from './type-compat.js';

// ── Convention helpers ────────────────────────────────────────────────────────
export { extractEntity, candidateTargets } from './conventions.js';
export type { EntityMatch } from './conventions.js';
