/**
 * createMssqlSchemaAdapter — strategy-backed factory for the SQL Server schema adapter.
 * Design §"Registry lives in the factory; selection iterates in priority order".
 *
 * Responsibilities:
 *   1. Build ordered strategy list from config via buildMssqlStrategies.
 *   2. Probe strategies in order via selectStrategy (detect + canConnect).
 *   3. Wrap the winning strategy in StrategyBackedSchemaAdapter.
 *   4. Return the adapter — already-connected, no open() call needed.
 *
 * Back-compat:
 *   - sql/ntlm configs → NativeTediousStrategy wins (same behavior as before).
 *   - integrated config → NativeTediousStrategy is omitted; SqlcmdStrategy is tried.
 *   - Missing 'mssql' driver for explicit-cred configs → ConnectionError('npm i mssql').
 *
 * US-027 (SQL Server adapter), ADR-004 (seam), ADR-006 (lazy optional import).
 * connectivity-strategies Batch C, task C3.3.
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { MssqlAdapterConfig } from '../../../core/ports/schema-adapter.js';
import type { ConnectivityStrategy } from '../../../core/ports/connectivity-strategy.js';
import type { Logger } from '../../../core/ports/logger.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import { noopLogger } from '../../../core/ports/logger.js';
import { MSSQL_CAPABILITIES } from './capabilities.js';
import { buildMssqlStrategies } from './strategies/registry.js';
import { selectStrategy } from './strategies/registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// StrategyBackedSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thin SchemaAdapter implementation that delegates to a ConnectivityStrategy.
 *
 *   extract(scope)  → strategy.runCatalog(scope)
 *   fingerprint()   → strategy.fingerprint?.() or fallback content-hash
 *   close()         → strategy.close?.() (idempotent)
 *
 * Constructed by createMssqlSchemaAdapter after selectStrategy picks a winner.
 */
class StrategyBackedSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'mssql' as const;
  readonly capabilities: CapabilityMatrix = MSSQL_CAPABILITIES;

  private _closed = false;

  constructor(private readonly _strategy: ConnectivityStrategy) {}

  /**
   * Delegates catalog extraction to the selected strategy's runCatalog().
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    if (this._closed) {
      throw new Error(
        'StrategyBackedSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }
    return this._strategy.runCatalog(scope);
  }

  /**
   * Delegates fingerprint computation to the strategy's fingerprint() method.
   * Falls back to a deterministic hash derived from running a catalog extraction
   * if the strategy does not implement fingerprint() (should not happen in practice
   * for Batch C strategies, but guards the interface contract).
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new Error(
        'StrategyBackedSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }
    if (typeof this._strategy.fingerprint === 'function') {
      return this._strategy.fingerprint();
    }
    // Intentionally throws rather than returning a misleading static hash.
    // A strategy that wins canConnect() and runCatalog() MUST also implement
    // fingerprint() — a silent static hash would defeat DDL-change detection
    // (US-009) without any diagnostic signal. Throwing makes the gap explicit.
    throw new Error(
      `StrategyBackedSchemaAdapter: strategy "${this._strategy.id}" does not implement fingerprint(). ` +
      'Implement fingerprint() in the strategy to support DDL-change detection (US-009).',
    );
  }

  /**
   * Releases resources held by the strategy. Idempotent.
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this._strategy.close?.();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional dependencies for createMssqlSchemaAdapter.
 * All fields are optional — omit entirely for production use.
 */
export interface MssqlSchemaAdapterDeps {
  /** Logger port instance for strategy-selection transparency. Defaults to noopLogger. */
  readonly logger?: Logger;
  /** Override NativeTediousStrategy constructor — for testing only. */
  readonly NativeTedious?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
  /** Override SqlcmdStrategy constructor — for testing only. */
  readonly Sqlcmd?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
  /** Override ManualDumpStrategy constructor — for testing only. */
  readonly ManualDump?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
  /** Override ConsentedInstallStrategy constructor — for testing only. */
  readonly ConsentedInstall?: new (config: MssqlAdapterConfig, logger: Logger, os?: string) => ConnectivityStrategy;
}

/**
 * Opens a SQL Server connection (or prepares an external-tool strategy) and
 * returns a SchemaAdapter. The adapter is already-connected — no open() call needed.
 *
 * Strategy selection order (see registry.ts):
 *   1. NativeTediousStrategy — explicit-credential (sql/ntlm) configs only
 *   2. SqlcmdStrategy        — integrated auth or fallback if native fails
 *
 * @param config - MssqlAdapterConfig: server/database/authentication/TLS options.
 * @param deps   - Optional deps for selection transparency and testability.
 *
 * @throws ConnectionError if mssql is not installed for an explicit-cred config
 *         (native strategy propagates the 'npm i mssql' message — back-compat).
 * @throws ConnectionError if native pool cannot connect (credentials, network, TLS).
 * @throws StrategyExhaustionError if all strategies fail to detect + connect.
 */
export async function createMssqlSchemaAdapter(
  config: MssqlAdapterConfig,
  deps: MssqlSchemaAdapterDeps = {},
): Promise<SchemaAdapter> {
  const logger = deps.logger ?? noopLogger;

  // Build ordered strategy list and select the first viable one.
  // Pass strategy constructor overrides and logger if provided (for testing/transparency).
  const strategies = buildMssqlStrategies(config, {
    logger,
    ...(deps.NativeTedious !== undefined ? { NativeTedious: deps.NativeTedious } : {}),
    ...(deps.Sqlcmd !== undefined ? { Sqlcmd: deps.Sqlcmd } : {}),
    ...(deps.ManualDump !== undefined ? { ManualDump: deps.ManualDump } : {}),
    ...(deps.ConsentedInstall !== undefined ? { ConsentedInstall: deps.ConsentedInstall } : {}),
  });
  const strategy = await selectStrategy(strategies, logger);

  return new StrategyBackedSchemaAdapter(strategy);
}
