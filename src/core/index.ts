/**
 * Core public surface barrel — design §2 "Public API surface".
 * This is the ONLY export point for core. Other layers (adapters, mcp, cli)
 * MUST import from here, never from internal sub-modules.
 *
 * ADR-004: this file imports NOTHING from adapters, drivers, mcp, or cli.
 * The adapter factory (createSqliteGraphStore) is wired at src/index.ts only.
 */

// ── Model types (runtime constants + TypeScript types) ───────────────────────
export {
  NODE_KINDS,
  INDEX_LEVELS,
  type NodeKind,
  type IndexLevel,
  type ObjectTypeLevels,
  type NodePayload,
  type TablePayload,
  type ColumnPayload,
  type ConstraintPayload,
  type IndexPayload,
  type RoutinePayload,
  type TriggerPayload,
  type GraphNode,
} from './model/node.js';

export {
  EDGE_KINDS,
  EDGE_CONFIDENCE_VALUES,
  type EdgeKind,
  type EdgeConfidence,
  type EdgeAttrs,
  type GraphEdge,
} from './model/edge.js';

export {
  type RawCatalog,
  type RawObject,
  type RawColumn,
  type RawConstraint,
  type RawIndex,
  type RawTriggerInfo,
  type RawDependency,
} from './model/catalog.js';

export {
  type CapabilityMatrix,
  type ExtractionScope,
} from './model/capability.js';

export {
  type NormalizedGraph,
  type NormalizationResult,
  type StubInfo,
} from './model/graph.js';

// ── Ports ─────────────────────────────────────────────────────────────────────
export {
  type GraphStore,
  type UpsertResult,
  type SearchHit,
  type SnapshotRecord,
  type SnapshotObjectRow,
  type NeighborQuery,
  type NeighborGroups,
  type ImpactQuery,
  type ImpactChain,
  type ImpactResult,
  type PathQuery,
  type JoinHop,
  type PathResult,
  type SearchQuery,
} from './ports/graph-store.js';

export {
  type Logger,
  noopLogger,
} from './ports/logger.js';

export {
  type SchemaAdapter,
  type SchemaAdapterConfig,
  type SqliteAdapterConfig,
  type MssqlAdapterConfig,
  type PgAdapterConfig,
  type MysqlAdapterConfig,
} from './ports/schema-adapter.js';

export {
  type ConnectivityStrategy,
  type DetectResult,
  type StrategyAttempt,
} from './ports/connectivity-strategy.js';

// ── Normalize ─────────────────────────────────────────────────────────────────
export { normalizeCatalog } from './normalize/normalize.js';
export { nodeId, edgeId, canonicalQName, stableStringify } from './normalize/id.js';
export { applyLevel, normalizeBody, type LevelResult } from './normalize/levels.js';

// ── Query engine ──────────────────────────────────────────────────────────────
export { getNeighbors } from './query/neighbors.js';
export { getImpact } from './query/impact.js';
export { findJoinPath } from './query/path.js';
export { search, LEVENSHTEIN_THRESHOLD, TYPO_CAP, type SearchResult } from './query/search.js';

// ── Presentation (present/) — pure formatters shared across CLI + MCP ────────
// ADR-004: present/ imports ONLY core model/port types — no adapters/cli/mcp.
export {
  formatExplore,
  type ExploreDetail,
  type ExploreView,
} from './present/explore.js';

export {
  formatSearch,
  type SearchDetail,
  type SearchView,
} from './present/search.js';

export {
  formatObject,
  type ObjectDetail,
  type ObjectView,
} from './present/object.js';

export {
  formatRelated,
  type RelatedDetail,
  type RelatedView,
} from './present/related.js';

export {
  formatImpact,
  type ImpactDetail,
  type ImpactView,
} from './present/impact.js';

export {
  formatPath,
  type PathView,
} from './present/path.js';

export {
  formatStatus,
  type StatusDetail,
  type McpStatusView,
} from './present/status.js';

export {
  formatPrecheck,
  type PrecheckDetail,
  type PrecheckView,
  type PrecheckItem,
  type PrecheckImpactSection,
} from './present/precheck.js';

// ── Precheck core (extractIdentifiers + runPrecheck) — shared by MCP + CLI ───
// ADR-004: neutral module; imports only core query fns + ports.
// Both src/mcp/tools/precheck.ts and src/cli/commands/affected.ts consume via barrel.
export { extractIdentifiers, runPrecheck } from './precheck/index.js';

// ── Error classes ─────────────────────────────────────────────────────────────
export {
  DbgraphError,
  NormalizationError,
  StorageError,
  SchemaVersionError,
  QueryError,
  NotFoundError,
  ConnectionError,
  PermissionError,
  ConfigError,
  UnsupportedDialectError,
  StrategyExhaustionError,
} from './errors.js';
