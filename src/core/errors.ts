/**
 * Typed error classes for dbgraph core.
 * Design §7.1 — each error carries a stable code, extends DbgraphError,
 * and has an actionable message. Never bare strings; nothing is swallowed.
 */

/**
 * Base error class for all dbgraph errors.
 * Carries a stable, machine-readable `code` for programmatic handling.
 */
export class DbgraphError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
    // Maintain proper prototype chain in environments that transpile classes.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the normalizer encounters a structural violation in a RawCatalog.
 * Message identifies which object and which field failed, e.g.:
 *   "object dbo.orders: constraint FK_x has misaligned columns (2 src, 3 dst)"
 */
export class NormalizationError extends DbgraphError {
  constructor(message: string) {
    super(message, 'E_NORMALIZE');
  }
}

/**
 * Thrown when the SQLite adapter encounters a driver-level failure.
 * Wraps the underlying error as `cause` so the driver's original stack is preserved.
 */
export class StorageError extends DbgraphError {
  constructor(message: string, cause?: unknown) {
    super(message, 'E_STORAGE');
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when the on-disk database was written by a newer version of dbgraph
 * than the running binary supports (observed > supported).
 * Message instructs the user to re-sync to rebuild the index.
 */
export class SchemaVersionError extends DbgraphError {
  constructor(
    readonly observed: number,
    readonly supported: number,
  ) {
    super(
      `Database schema version ${observed} is newer than supported version ${supported}. ` +
        'Please re-sync to rebuild the index with the current dbgraph version.',
      'E_SCHEMA_VERSION',
    );
  }
}

/**
 * Thrown when a query is called with invalid parameters (e.g. depth < 1).
 * Message describes the invalid parameter and its expected range.
 */
export class QueryError extends DbgraphError {
  constructor(message: string) {
    super(message, 'E_QUERY');
  }
}

/**
 * Thrown when a requested node id or qname is not found in the graph store.
 * Message identifies what was looked up and instructs the user to re-sync.
 */
export class NotFoundError extends DbgraphError {
  constructor(kind: string, identifier: string) {
    super(
      `${kind} not found: "${identifier}". ` +
        'If the object was recently extracted, please re-sync to update the index.',
      'E_NOT_FOUND',
    );
  }
}

/**
 * Thrown when configuration is invalid, malformed, or unsafe.
 * Examples: missing required field, unknown dialect, inline plaintext credential,
 * or an unset env variable referenced by ${env:VAR}.
 * Message MUST be actionable — naming the offending field and corrective action.
 */
export class ConfigError extends DbgraphError {
  constructor(message: string) {
    super(message, 'E_CONFIG');
  }
}

/**
 * Thrown when a requested dialect has no registered adapter.
 * Message names the bad dialect and lists the available dialects.
 */
export class UnsupportedDialectError extends DbgraphError {
  constructor(dialect: string) {
    super(
      `Unsupported dialect: "${dialect}". Available dialects: sqlite, mssql, pg, mysql.`,
      'E_UNSUPPORTED_DIALECT',
    );
  }
}

// Forward import — type-only to stay within core boundary (ADR-004).
// StrategyAttempt is defined in the port file; we re-use the type here.
import type { StrategyAttempt } from './ports/connectivity-strategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// ConnectivityOption + ConnectivityOutcome — core types (driver-free)
// resilient-connectivity Batch 1, task 1.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A discriminated union of the actionable options presented to the user when no
 * connectivity method can be established. Three variants MUST always be present.
 *
 * Design §"ConnectivityOutcome + options live in core" — these are pure data
 * (engine-neutral, driver-free). Adapters BUILD the value; present/ RENDERS it.
 */
export type ConnectivityOption =
  | {
      /** Emit the exact read-only catalog SELECT queries for the user to run themselves. */
      readonly kind: 'run-it-yourself';
      readonly description: string;
      /** The EXACT read-only catalog SELECT statements, write-verb-free. */
      readonly queries: readonly string[];
    }
  | {
      /** Offer to install the missing driver/tool ONLY with explicit user consent. */
      readonly kind: 'consented-install';
      readonly description: string;
      readonly tool: string;
      readonly docUrl: string;
    }
  | {
      /** Import a combined JSON dump the user produced externally. */
      readonly kind: 'manual-dump';
      readonly description: string;
      readonly outputPath: string;
    };

/**
 * The structured, engine-neutral outcome yielded when no connectivity method
 * can establish a connection. Carries at least three actionable options.
 *
 * Design §"typed throw, not return-type change" — thrown as ConnectivityUnavailableError.
 * The summary field MUST be content-free (no schema names, object identifiers, or secrets).
 */
export interface ConnectivityOutcome {
  /** Stable engine identifier, e.g. 'mssql', 'pg', 'mysql', 'sqlite'. */
  readonly engine: string;
  /** Content-free human-readable summary. MUST NOT contain schema/identifier/secret. */
  readonly summary: string;
  /** Ordered list of strategies attempted and the reason each was skipped. */
  readonly attempts: readonly StrategyAttempt[];
  /** The at-least-three options offered to the user. Length MUST be >= 3. */
  readonly options: readonly ConnectivityOption[];
}

/**
 * Thrown when all connectivity strategies for an engine have been exhausted —
 * none could both detect their prerequisite AND successfully probe a connection.
 * Carries the ordered list of attempts and their individual reasons so callers
 * and the CLI presenter can surface actionable guidance.
 *
 * Code: E_STRATEGY_EXHAUSTION.
 * connectivity-strategies A1.3.
 */
export class StrategyExhaustionError extends DbgraphError {
  constructor(readonly attempts: readonly StrategyAttempt[]) {
    const list =
      attempts.length === 0
        ? 'No strategies were attempted.'
        : attempts.map((a) => `${a.id} — ${a.reason}`).join('; ');
    super(
      `All connectivity strategies exhausted. ${list}`,
      'E_STRATEGY_EXHAUSTION',
    );
  }
}

/**
 * Thrown when the engine adapter cannot connect to the source database.
 * Covers: file not found, file not a valid database, database locked/busy,
 * and required driver package not installed.
 * Message MUST be actionable — naming the failing condition and the corrective action.
 * Wraps the underlying driver error as `cause` so the original stack is preserved.
 * US-026 / US-031.
 */
export class ConnectionError extends DbgraphError {
  constructor(message: string, cause?: unknown) {
    super(message, 'E_CONNECTION');
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a write or otherwise disallowed operation is attempted on a
 * read-only source-database connection (US-031).
 * Wraps the underlying driver error as `cause`.
 */
export class PermissionError extends DbgraphError {
  constructor(message: string, cause?: unknown) {
    super(message, 'E_PERMISSION');
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when no connectivity method can be established for an engine.
 * Carries a structured, engine-neutral `ConnectivityOutcome` with at least
 * three actionable options (run-it-yourself, consented-install, manual-dump).
 *
 * Code: E_CONNECTIVITY_UNAVAILABLE.
 * Design §"typed throw, not return-type change" — bubbles to cli.ts catch boundary.
 * The message is content-free (carries outcome.summary only — no identifier/secret).
 * resilient-connectivity Batch 1, task 1.2.
 */
export class ConnectivityUnavailableError extends DbgraphError {
  constructor(readonly outcome: ConnectivityOutcome) {
    super(outcome.summary, 'E_CONNECTIVITY_UNAVAILABLE');
  }
}
