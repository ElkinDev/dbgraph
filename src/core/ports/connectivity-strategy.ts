/**
 * ConnectivityStrategy port — engine-agnostic strategy contract for schema extraction.
 * Design §"ConnectivityStrategy port in core, driver-free (ADR-004)".
 *
 * This file imports ONLY core model types (RawCatalog, ExtractionScope) and the Logger
 * port. It MUST NOT import any driver, external-tool, or node:child_process symbol.
 * Concrete strategies live under src/adapters/engines/<engine>/strategies/ (ADR-004).
 *
 * connectivity-strategies Batch A, task A1.1.
 */

import type { RawCatalog } from '../model/catalog.js';
import type { ExtractionScope } from '../model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Result and attempt types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a strategy's availability probe.
 * `available: false` when the prerequisite (tool on PATH, dump file, credentials) is absent.
 * `detail` carries human-readable discovery metadata (version, path, reason).
 */
export interface DetectResult {
  readonly available: boolean;
  /** Optional human-readable detail: tool version, file path, or reason unavailable. */
  readonly detail?: string;
}

/**
 * Records why a strategy was skipped or failed during selection.
 * Carried by StrategyExhaustionError to enumerate what was tried and why.
 */
export interface StrategyAttempt {
  /** The stable strategy identifier, e.g. 'native-tedious', 'sqlcmd', 'manual-dump'. */
  readonly id: string;
  /** Human-readable reason the strategy could not be used. */
  readonly reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectivityStrategy port
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The driven port every connectivity strategy MUST implement.
 *
 * Lifecycle (per extraction):
 *   detect()          — is the prerequisite available? (no DB connection opened)
 *   canConnect()      — cheap SELECT 1 / file-read probe
 *   runCatalog(scope) — full catalog extraction
 *   close?()          — release any held resources (idempotent)
 *
 * The port is implementable by any engine without changing core (ADR-004).
 * ZERO driver, tool, or node:child_process imports are permitted here.
 */
export interface ConnectivityStrategy {
  /**
   * Stable identifier for logging and error reporting.
   * Examples: 'native-tedious', 'sqlcmd', 'manual-dump', 'consented-install'.
   */
  readonly id: string;

  /**
   * Probe whether the strategy's prerequisite is present on this machine.
   * MUST NOT open a database connection.
   * A failed or timed-out probe MUST resolve { available: false }, never reject.
   */
  detect(): Promise<DetectResult>;

  /**
   * Cheap connectivity probe (SELECT 1 / file readable).
   * Called only when detect() resolved available: true.
   * Returns true when the strategy can likely run a full extraction.
   */
  canConnect(): Promise<boolean>;

  /**
   * Execute the full catalog extraction and return a RawCatalog.
   * MUST issue ONLY catalog SELECT statements (read-only inviolable, US-031).
   */
  runCatalog(scope: ExtractionScope): Promise<RawCatalog>;

  /**
   * Compute a cheap DDL-sensitive fingerprint for the current schema.
   * Optional. When absent, StrategyBackedSchemaAdapter falls back to a
   * content-hash over the extracted catalog (if available in the future).
   * When present, MUST change on DDL changes and be stable on DML (US-009).
   * Issues exactly ONE catalog query — does NOT walk all objects.
   */
  fingerprint?(): Promise<string>;

  /**
   * Release any held resources (connection pool, file handle, etc.).
   * Optional. When present, MUST be idempotent — a second call MUST NOT throw.
   */
  close?(): Promise<void>;
}
