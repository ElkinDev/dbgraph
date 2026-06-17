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
      `Unsupported dialect: "${dialect}". Available dialects: sqlite, mssql.`,
      'E_UNSUPPORTED_DIALECT',
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
