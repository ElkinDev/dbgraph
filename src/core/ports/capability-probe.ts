/**
 * CapabilityProbe port — engine-agnostic capability detection contract.
 * Design §"probe() is OPTIONAL on the strategy port; per-engine probe in adapters".
 * Resilient-connectivity Batch 1, task 1.1.
 *
 * This file imports ONLY core types. It MUST NOT import any driver,
 * external-tool, node:child_process, adapter, cli, or mcp symbol (ADR-004).
 * Concrete probe implementations live under src/adapters/engines/<engine>/probe.ts.
 *
 * The probe contract:
 *   - MUST NOT throw — any detection failure reports as a negative result
 *   - MUST NOT open a database connection to determine availability
 *   - MUST NOT issue any write
 */

// ─────────────────────────────────────────────────────────────────────────────
// Supporting types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Information about a single CLI tool found (or not found) on PATH.
 * `version` and `path` are null when the tool is absent or its version is
 * unparseable from the tool's own output.
 */
export interface CliToolInfo {
  /** Stable tool name, e.g. 'sqlcmd', 'psql', 'mysql'. */
  readonly tool: string;
  /** Parsed version string, or null if absent or unparseable. */
  readonly version: string | null;
  /** Resolved absolute path, or null if not found on PATH. */
  readonly path: string | null;
}

/**
 * The result of running a capability probe for a given engine.
 * All fields are non-throwing — unavailability is a false/null/empty value.
 */
export interface ProbeResult {
  /** Whether the engine's native driver package is importable (no DB connection attempted). */
  readonly nativeDriver: boolean;
  /** Zero or more CLI tools scanned on PATH — one entry per relevant tool for this engine. */
  readonly cliTools: readonly CliToolInfo[];
  /** Whether an ODBC driver is present (applicable to mssql; false for other engines). */
  readonly odbc: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CapabilityProbe port
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The driver port every per-engine capability probe MUST implement.
 *
 * Implementations live in src/adapters/engines/<engine>/probe.ts.
 * This interface is consumed driver-free by:
 *   - core/present/doctor.ts (content-free report)
 *   - adapters/engines/mssql/strategies/profiles.ts (resolveProfile)
 *   - cli/commands/doctor.ts (runDoctor)
 *
 * ZERO driver, tool, or node:child_process imports are permitted here.
 */
export interface CapabilityProbe {
  /**
   * Stable engine identifier, e.g. 'mssql', 'pg', 'mysql', 'sqlite'.
   */
  readonly engine: string;

  /**
   * Run a full capability detection for this engine and return the result.
   *
   * MUST resolve — never reject.
   * MUST NOT open a database connection.
   * MUST NOT issue any write.
   * A timed-out or failed detection step MUST be reported as a negative result.
   */
  probe(): Promise<ProbeResult>;
}
