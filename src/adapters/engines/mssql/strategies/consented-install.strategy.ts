/**
 * consented-install.strategy.ts — B1 guided install strategy (consent gate only).
 *
 * This strategy is the LAST in the registry order. When reached, it does NOT
 * execute any installer — it prints official install instructions via Logger.info
 * behind a clear consent notice and then throws StrategyExhaustionError carrying
 * the guidance.
 *
 * B1 = GUIDED ONLY (Batch E, in scope):
 *   - Detects that this is the last resort (always available: true from detect()).
 *   - canConnect() always returns false (it cannot actually connect — it guides).
 *   - runCatalog() prints the consent notice + official instructions, then throws.
 *
 * B2 = AUTOMATED EXECUTION (DEFERRED — out of scope for this batch):
 *   A clearly-marked seam is left below. B2 would replace the "throw" with a
 *   consented spawn of the official installer. The seam is intentional — it is
 *   NOT implemented here and NOT a hidden gap.
 *
 * Spec cli-config "Guided install prints instructions only, never auto-executes".
 * Spec cli-config "Automated install is stated as a deferred limitation".
 * connectivity-strategies Batch E, task E5.2.
 */

import type { ConnectivityStrategy, DetectResult } from '../../../../core/ports/connectivity-strategy.js';
import type { RawCatalog } from '../../../../core/model/catalog.js';
import type { ExtractionScope } from '../../../../core/model/capability.js';
import type { MssqlAdapterConfig } from '../../../../core/ports/schema-adapter.js';
import type { Logger } from '../../../../core/ports/logger.js';
import { StrategyExhaustionError } from '../../../../core/errors.js';
import { getRecipes, type RecipeOs } from './install-recipes.js';

// ─────────────────────────────────────────────────────────────────────────────
// ConsentedInstallStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The guided-install (B1) fallback strategy.
 *
 * When selected, it informs the user that dbgraph can guide them to install the
 * required tool from an official Microsoft source. Nothing is installed
 * automatically (B2 is deferred).
 *
 * @param config - MssqlAdapterConfig (used for context; no live connection made).
 * @param logger - Logger port — all guidance is emitted via logger.info.
 * @param os     - Operating system platform (defaults to process.platform).
 */
export class ConsentedInstallStrategy implements ConnectivityStrategy {
  readonly id = 'consented-install';

  private readonly config: MssqlAdapterConfig;
  private readonly logger: Logger;
  private readonly os: string;

  constructor(
    config: MssqlAdapterConfig,
    logger: Logger,
    os: string = process.platform,
  ) {
    this.config = config;
    this.logger = logger;
    this.os = os;
  }

  // ── detect() ───────────────────────────────────────────────────────────────

  /**
   * Always returns available: true.
   *
   * This strategy is always "available" as a last resort — it can always print
   * guidance even when no tool is installed. It is positioned last in the
   * registry so it is only reached after all other strategies are exhausted.
   */
  async detect(): Promise<DetectResult> {
    return { available: true };
  }

  // ── canConnect() ───────────────────────────────────────────────────────────

  /**
   * Always returns false.
   *
   * The guided-install strategy cannot establish an actual database connection —
   * it only prints guidance. Returning false here ensures that selectStrategy
   * records an attempt and falls through to the exhaustion path, where the CLI
   * can surface both the manual-dump and guided-install options together.
   *
   * NOTE: runCatalog() is also wired to handle the case where selectStrategy
   * somehow calls it directly (it prints guidance and throws). The double-gate
   * (canConnect: false + runCatalog: throw) ensures no silent partial catalog.
   */
  async canConnect(): Promise<boolean> {
    return false;
  }

  // ── runCatalog() ───────────────────────────────────────────────────────────

  /**
   * Prints official install instructions behind an explicit consent notice via
   * Logger.info, then throws StrategyExhaustionError carrying the guidance.
   *
   * NO installer is executed. NO child process is spawned. This is B1 guidance only.
   *
   * // B2: automated execution goes here — when the user consents, spawn the
   * // official installer (winget / brew / package manager) with the recipe id.
   * // Implementation is DEFERRED to a follow-up change.
   *
   * @throws StrategyExhaustionError always — this strategy never produces a catalog.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async runCatalog(_scope: ExtractionScope): Promise<RawCatalog> {
    const tool = 'sqlcmd';
    const recipes = getRecipes(tool, this.os as RecipeOs);

    // ── Consent notice ────────────────────────────────────────────────────────
    this.logger.info(
      '[dbgraph guided install — B1] dbgraph can guide you to install the required tool ' +
        `from an official Microsoft source. Nothing is installed automatically.`,
    );

    // ── Per-recipe instructions ────────────────────────────────────────────────
    if (recipes.length === 0) {
      this.logger.info(
        `[dbgraph guided install] No known recipe for tool "${tool}" on OS "${this.os}". ` +
          `Visit https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility for install instructions.`,
      );
    } else {
      for (const recipe of recipes) {
        if (recipe.method === 'winget' && recipe.id !== undefined) {
          this.logger.info(
            `[dbgraph guided install] Install via Windows Package Manager (winget):\n` +
              `  winget install --id ${recipe.id}\n` +
              `Official source: ${recipe.url}`,
          );
        } else if (recipe.method === 'brew' && recipe.id !== undefined) {
          this.logger.info(
            `[dbgraph guided install] Install via Homebrew:\n` +
              `  brew install ${recipe.id}\n` +
              `Official source: ${recipe.url}`,
          );
        } else {
          this.logger.info(
            `[dbgraph guided install] Install from the official Microsoft source:\n` +
              `  ${recipe.url}`,
          );
        }
      }
    }

    // ── B2 seam ───────────────────────────────────────────────────────────────
    // B2: automated execution goes here — when the user consents, spawn the
    // official installer (winget / brew / package manager) with the recipe id.
    // Implementation is DEFERRED to a follow-up change (B2 out of scope for Batch E).

    // ── Throw exhaustion error carrying the guidance ──────────────────────────
    const guidanceReason =
      `B1 guided install shown — official ${tool} install instructions printed above. ` +
      `Re-run after installing ${tool} from the official Microsoft source. ` +
      `Automated installer execution (B2) is DEFERRED to a follow-up change.`;

    throw new StrategyExhaustionError([
      { id: this.id, reason: guidanceReason },
    ]);
  }

  // ── close() ────────────────────────────────────────────────────────────────

  /**
   * No-op — consented-install holds no async resources.
   */
  async close(): Promise<void> {
    // intentionally empty — no pool, no process, no handle to release
  }
}
