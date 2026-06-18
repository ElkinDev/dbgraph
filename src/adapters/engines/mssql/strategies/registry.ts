/**
 * registry.ts — MSSQL connectivity strategy registry.
 *
 * Exports:
 *   buildMssqlStrategies(config, deps?) → ordered ConnectivityStrategy[]
 *   selectStrategy(strategies, logger)  → Promise<ConnectivityStrategy> (first to pass
 *                                         both detect() AND canConnect())
 *   detectAllCandidates(config, deps?)  → Promise<CandidateDetectResult[]>
 *                                         (reports detection results for ALL 3 spec-mandated
 *                                          candidates: sqlcmd, Invoke-Sqlcmd, ODBC Driver)
 *
 * runCatalog registry order (Batches C + D + E):
 *   1. NativeTediousStrategy    — ONLY when authentication.type !== 'integrated'
 *      (tedious cannot perform Windows Integrated Security, ADR-006)
 *   2. SqlcmdStrategy           — always included (integrated-auth primary path)
 *   3. ManualDumpStrategy       — offline JSON ingest (Batch D)
 *   4. ConsentedInstallStrategy — guided install B1, last resort (Batch E)
 *
 * Detection candidates (WARN-3 — connectivity spec §"at least 3 SQL Server candidates"):
 *   1. sqlcmd          — full runCatalog strategy (SqlcmdStrategy)
 *   2. Invoke-Sqlcmd   — detection only; PowerShell SqlServer module (InvokeSqlcmdStrategy)
 *   3. ODBC Driver     — detection only; Windows registry probe (OdbcDriverStrategy)
 *   Candidates 2 and 3 are DETECTED + reported; their canConnect() always returns false
 *   so they are extensible to full runCatalog strategies in a future phase.
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
 * connectivity-strategies Batches C + D + E + WARN-3 remediation.
 */

import type { ConnectivityStrategy, DetectResult, StrategyAttempt } from '../../../../core/ports/connectivity-strategy.js';
import type { Logger } from '../../../../core/ports/logger.js';
import type { MssqlAdapterConfig } from '../../../../core/ports/schema-adapter.js';
import { StrategyExhaustionError } from '../../../../core/errors.js';
import { noopLogger } from '../../../../core/ports/logger.js';
import { NativeTediousStrategy } from './native-tedious.strategy.js';
import { SqlcmdStrategy } from './sqlcmd.strategy.js';
import { ManualDumpStrategy } from './manual-dump.strategy.js';
import { ConsentedInstallStrategy } from './consented-install.strategy.js';
import { InvokeSqlcmdStrategy } from './invoke-sqlcmd.strategy.js';
import { OdbcDriverStrategy } from './odbc-driver.strategy.js';

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
  /** Override the ManualDumpStrategy constructor (for testing). */
  readonly ManualDump?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
  /** Override the ConsentedInstallStrategy constructor (for testing). */
  readonly ConsentedInstall?: new (config: MssqlAdapterConfig, logger: Logger, os?: string) => ConnectivityStrategy;
  /** Override the InvokeSqlcmdStrategy constructor (for testing — WARN-3). */
  readonly InvokeSqlcmd?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
  /** Override the OdbcDriverStrategy constructor (for testing — WARN-3). */
  readonly OdbcDriver?: new (config: MssqlAdapterConfig) => ConnectivityStrategy;
  /**
   * Logger passed to ConsentedInstallStrategy so it can emit guidance via Logger.info.
   * Defaults to noopLogger when not provided (back-compat).
   */
  readonly logger?: Logger;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildMssqlStrategies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the ordered list of connectivity strategies for a given MssqlAdapterConfig.
 *
 * Order:
 *   1. NativeTediousStrategy    — only for explicit-credential configs (sql/ntlm)
 *   2. SqlcmdStrategy           — always included (integrated-auth primary path)
 *   3. ManualDumpStrategy       — offline JSON ingest
 *   4. ConsentedInstallStrategy — guided install B1, last resort
 *
 * @param config - MssqlAdapterConfig whose authentication discriminant drives ordering.
 * @param deps   - Optional constructor overrides and logger for testing/transparency.
 * @returns Ordered ConnectivityStrategy[]; at least one strategy is always returned.
 */
export function buildMssqlStrategies(
  config: MssqlAdapterConfig,
  deps: MssqlStrategyDeps = {},
): ConnectivityStrategy[] {
  const strategies: ConnectivityStrategy[] = [];
  const logger: Logger = deps.logger ?? noopLogger;

  // NativeTedious is ONLY viable for explicit-credential configs.
  // Integrated auth is handled exclusively by external-tool strategies.
  if (config.authentication.type !== 'integrated') {
    const Native = deps.NativeTedious ?? NativeTediousStrategy;
    strategies.push(new Native(config));
  }

  // SqlcmdStrategy is always included — primary path for integrated auth.
  const Sqlcmd = deps.Sqlcmd ?? SqlcmdStrategy;
  strategies.push(new Sqlcmd(config));

  // ManualDumpStrategy — offline JSON ingest (Batch D).
  // Falls back to the default dump path (.dbgraph/dumps/mssql-dump.json).
  const ManualDump = deps.ManualDump ?? ManualDumpStrategy;
  strategies.push(new ManualDump(config));

  // ConsentedInstallStrategy — guided install B1, always last (Batch E).
  // Receives the logger so it can print consent notices and install guidance.
  const ConsentedInstall = deps.ConsentedInstall ?? ConsentedInstallStrategy;
  strategies.push(new ConsentedInstall(config, logger));

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

// ─────────────────────────────────────────────────────────────────────────────
// detectAllCandidates (WARN-3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detection result for a single connectivity candidate.
 * Used by detectAllCandidates() to report ALL spec-mandated detection probes.
 */
export interface CandidateDetectResult {
  /** Strategy / candidate identifier. */
  readonly id: string;
  /** Raw DetectResult from the strategy's detect() method. */
  readonly detect: DetectResult;
}

/**
 * Runs detect() for ALL three spec-mandated candidates and returns results.
 *
 * Candidates:
 *   1. sqlcmd         — SqlcmdStrategy (full runCatalog strategy)
 *   2. invoke-sqlcmd  — InvokeSqlcmdStrategy (detection only for now)
 *   3. odbc-driver    — OdbcDriverStrategy (detection only for now)
 *
 * This function is separate from buildMssqlStrategies / selectStrategy because
 * candidates 2 and 3 are detection-only (their canConnect() returns false),
 * so they are NOT in the runCatalog selection pipeline but ARE reported here
 * for diagnostic and transparency purposes.
 *
 * @param config - MssqlAdapterConfig (used to construct strategy instances).
 * @param deps   - Optional overrides for testing.
 * @returns Array of CandidateDetectResult in probe order (sqlcmd first).
 */
export async function detectAllCandidates(
  config: MssqlAdapterConfig,
  deps: Pick<MssqlStrategyDeps, 'Sqlcmd' | 'InvokeSqlcmd' | 'OdbcDriver'> = {},
): Promise<CandidateDetectResult[]> {
  const SqlcmdCtor = deps.Sqlcmd ?? SqlcmdStrategy;
  const InvokeSqlcmdCtor = deps.InvokeSqlcmd ?? InvokeSqlcmdStrategy;
  const OdbcDriverCtor = deps.OdbcDriver ?? OdbcDriverStrategy;

  const candidates = [
    new SqlcmdCtor(config),
    new InvokeSqlcmdCtor(config),
    new OdbcDriverCtor(config),
  ];

  return Promise.all(
    candidates.map(async (candidate): Promise<CandidateDetectResult> => ({
      id: candidate.id,
      detect: await candidate.detect(),
    })),
  );
}
