/**
 * Model barrel — re-exports all graph domain types and runtime constants.
 * Design §2 — this barrel is the model surface re-exported through src/core/index.ts.
 */

// node.ts
export {
  NODE_KINDS,
  INDEX_LEVELS,
} from './node.js';
export type {
  NodeKind,
  IndexLevel,
  ObjectTypeLevels,
  NodePayload,
  TablePayload,
  ColumnPayload,
  ConstraintPayload,
  IndexPayload,
  RoutinePayload,
  TriggerPayload,
  FieldPayload,
  GraphNode,
} from './node.js';

// edge.ts
export {
  EDGE_KINDS,
  EDGE_CONFIDENCE_VALUES,
} from './edge.js';
export type {
  EdgeKind,
  EdgeConfidence,
  EdgeAttrs,
  GraphEdge,
} from './edge.js';

// catalog.ts
export type {
  RawCatalog,
  RawObject,
  RawField,
  RawColumn,
  RawConstraint,
  RawIndex,
  RawTriggerInfo,
  RawDependency,
} from './catalog.js';

// capability.ts
export { DEFAULT_LEVELS } from './capability.js';
export type {
  CapabilityMatrix,
  ExtractionScope,
} from './capability.js';

// graph.ts
export type {
  NormalizedGraph,
  StubInfo,
  OmittedKindInfo,
  NormalizationResult,
} from './graph.js';
