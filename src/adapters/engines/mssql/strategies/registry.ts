/**
 * registry.ts — MSSQL connectivity strategy registry.
 *
 * Exports:
 *   buildMssqlStrategies(config, deps?) → ordered ConnectivityStrategy[]
 *   selectStrategy(strategies, logger)  → Promise<ConnectivityStrategy> (first to pass
 *                                         both detect() AND canConnect())
 *
 * Registry order for THIS batch (C):
 *   1. NativeTediousStrategy — ONLY when authentication.type !== 'integrated'
 *      (tedious cannot perform Windows Integrated Security, ADR-006)
 *   2. SqlcmdStrategy
 *
 * Batches D and E will append:
 *   3. ManualDumpStrategy   (offline JSON ingest — Batch D)
 *   4. ConsentedInstallStrategy (guided install — Batch E)
 *
 * Selection algorithm (selectStrategy):
 *   For each strategy in order:
 *     - await detect(): if not available → log debug, record attempt, continue
 *     - await canConnect(): if false → log debug, record attempt, continue
 *     - FIRST strategy that passes BOTH wins → log info, return it
 *   If none pass → throw StrategyExhaustionError(attempts)
 *
 * Logging contract (Logger port, ADR-004):
 *   - logger.debug per skipped probe (never logs a secret)
 *   - logger.info for the winning strategy
 *   - No credential value ever appears in a log line
 *
 * connectivity-strategies Batch C, tasks C3.1–C3.2.
 */

import type { ConnectivityStrategy, StrategyAttempt } from '../../../../core/ports/connectivity-strategy.js';
import type { Logger } from '../../../../core/ports/logger.js';
import type { MssqlAdapterConfig } from '../../../../core/ports/schema-adapter.js';
import { StrategyExhaustionError } from '../../../../core/errors.js';
import { NativeTediousStrategy } from './native-tedious.strategy.js';
import { SqlcmdStrategy } from './sqlcmd.strategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dependency injection seam (for testability in Batch C)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional dependency overrides for testing or future extension.
 * Callers that do not inject anything get the default production strategies.
 */
export interface MssqlStrategyDeps {
  /** Override the NativeTediousStrategy constructor (for testing). */
  readonly NativeTedious?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
  /** Override the SqlcmdStrategy constructor (for testing). */
  readonly Sqlcmd?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildMssqlStrategies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the ordered list of connectivity strategies for a given MssqlAdapterConfig.
 *
 * Order:
 *   1. NativeTediousStrategy — only for explicit-credential configs (sql/ntlm)
 *   2. SqlcmdStrategy        — always included (integrated-auth primary path)
 *   [ ManualDumpStrategy and ConsentedInstallStrategy are added in Batches D/E ]
 *
 * @param config - MssqlAdapterConfig whose authentication discriminant drives ordering.
 * @param deps   - Optional constructor overrides for testing.
 * @returns Ordered ConnectivityStrategy[]; at least one strategy is always returned.
 */
export function buildMssqlStrategies(
  config: MssqlAdapterConfig,
  deps: MssqlStrategyDeps = {},
): ConnectivityStrategy[] {
  const strategies: ConnectivityStrategy[] = [];

  // NativeTedious is ONLY viable for explicit-credential configs.
  // Integrated auth is handled exclusively by external-tool strategies.
  if (config.authentication.type !== 'integrated') {
    const Native = deps.NativeTedious ?? NativeTediousStrategy;
    strategies.push(new Native(config));
  }

  // SqlcmdStrategy is always included — primary path for integrated auth.
  const Sqlcmd = deps.Sqlcmd ?? SqlcmdStrategy;
  strategies.push(new Sqlcmd(config));

  // ── Extension point: Batches D/E will push ManualDumpStrategy and
  // ConsentedInstallStrategy here, after SqlcmdStrategy. ──────────────────────

  return strategies;
}

// ─────────────────────────────────────────────────────────────────────────────
// selectStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Iterates the ordered strategy list, probing each with detect() + canConnect().
 * Returns the FIRST strategy that passes both probes.
 *
 * Logging (via Logger port — no secret ever logged):
 *   - debug for each skipped probe (with the strategy id and skip reason)
 *   - info for the winning strategy
 *
 * @param strategies - Ordered list from buildMssqlStrategies (or empty for no-op).
 * @param logger     - Logger port instance; use noopLogger to suppress output.
 * @throws StrategyExhaustionError if no strategy passes both probes.
 */
export async function selectStrategy(
  strategies: ConnectivityStrategy[],
  logger: Logger,
): Promise<ConnectivityStrategy> {
  const attempts: StrategyAttempt[] = [];

  for (const strategy of strategies) {
    const { id } = strategy;

    // ── Step 1: detect() ───────────────────────────────────────────────────
    const detectResult = await strategy.detect();

    if (!detectResult.available) {
      const reason = detectResult.detail ?? 'not available on this machine';
      logger.debug(`strategy probe: ${id} — detect() → unavailable`, { strategyId: id, reason });
      attempts.push({ id, reason });
      continue;
    }

    // ── Step 2: canConnect() ───────────────────────────────────────────────
    logger.debug(`strategy probe: ${id} — detect() → available, probing connection`, { strategyId: id });

    const connected = await strategy.canConnect();

    if (!connected) {
      const reason = 'canConnect() probe failed — connection refused or credentials invalid';
      logger.debug(`strategy probe: ${id} — canConnect() → false`, { strategyId: id, reason });
      attempts.push({ id, reason });
      continue;
    }

    // ── WINNER ─────────────────────────────────────────────────────────────
    logger.info(`connectivity strategy selected: ${id}`, { strategyId: id });
    return strategy;
  }

  // All strategies exhausted — throw typed error with attempt list
  throw new StrategyExhaustionError(attempts);
}
