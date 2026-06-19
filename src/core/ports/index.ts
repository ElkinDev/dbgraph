/**
 * Ports barrel — re-exports all port interfaces and supporting types.
 * Design §2 — these are re-exported through src/core/index.ts.
 */

export { noopLogger } from './logger.js';
export type { Logger } from './logger.js';

export type {
  GraphStore,
  UpsertResult,
  SearchHit,
  SnapshotRecord,
  NeighborQuery,
  NeighborGroups,
  ImpactQuery,
  ImpactChain,
  ImpactResult,
  PathQuery,
  JoinHop,
  PathResult,
  SearchQuery,
} from './graph-store.js';

export type {
  SchemaAdapter,
  SchemaAdapterConfig,
  SqliteAdapterConfig,
  MssqlAdapterConfig,
  PgAdapterConfig,
  MysqlAdapterConfig,
} from './schema-adapter.js';

export type {
  ConnectivityStrategy,
  DetectResult,
  StrategyAttempt,
} from './connectivity-strategy.js';
