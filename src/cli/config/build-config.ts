/**
 * buildConfig + writeConfig — task 1.6 (phase-4-cli-config).
 * buildConfig: the SINGLE pure function shared by both init flag form and -i wizard.
 *   - Validates that all connection-identity fields are ${env:VAR} references.
 *   - Throws ConfigError (naming the field) if any identity field is plaintext.
 * writeConfig: serializes a DbgraphConfig to a deterministic JSON string
 *   (JSON.stringify(cfg, null, 2) + '\n', FIXED key order per design Decision 5).
 * No process I/O; no adapter imports; pure functions (ADR-004, ADR-008).
 */

import { ConfigError } from '../../core/errors.js';
import type { DbgraphConfig, SqliteSource, MssqlSource } from '../../infra/config/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Identity-field validation (plaintext rejection)
// ─────────────────────────────────────────────────────────────────────────────

/** Pattern that matches a well-formed ${env:VAR} reference. */
const ENV_REF_RE = /^\$\{env:[A-Z_][A-Z0-9_]*\}$/;

/**
 * Returns true if the value is a valid ${env:VAR} reference.
 */
function isEnvRef(value: string): boolean {
  return ENV_REF_RE.test(value);
}

/**
 * Asserts that a connection-identity field is a ${env:VAR} reference.
 * Throws ConfigError instructing the user to use ${env:VAR} if it is not.
 */
function requireEnvRef(field: string, value: string): void {
  if (!isEnvRef(value)) {
    throw new ConfigError(
      `Config: field "${field}" must be a \${env:VAR} reference, not a literal value. ` +
        `Use a generic variable name such as DBGRAPH_DB_${field.toUpperCase()}.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input shape for buildConfig
// ─────────────────────────────────────────────────────────────────────────────

export type BuildConfigInput =
  | { dialect: 'sqlite'; file: string; driver?: 'better-sqlite3' | 'node:sqlite' }
  | {
      dialect: 'mssql';
      server: string;
      port?: string;
      database: string;
      user: string;
      domain?: string;
      password: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// buildConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a DbgraphConfig from structured inputs.
 * This is the SINGLE builder used by both the flag form and the -i wizard,
 * ensuring byte-identical output for identical inputs (ADR-008).
 *
 * Connection-identity fields (server/database/user/domain/password for mssql)
 * MUST be ${env:VAR} references — plaintext values throw ConfigError.
 * The sqlite "file" field is allowed to be a literal path.
 */
export function buildConfig(input: BuildConfigInput): DbgraphConfig {
  switch (input.dialect) {
    case 'sqlite': {
      const source: SqliteSource = { file: input.file };
      const base: DbgraphConfig =
        input.driver !== undefined
          ? { dialect: 'sqlite', source, driver: input.driver }
          : { dialect: 'sqlite', source };
      return base;
    }
    case 'mssql': {
      // Validate all identity fields are env refs
      requireEnvRef('server', input.server);
      requireEnvRef('database', input.database);
      requireEnvRef('user', input.user);
      requireEnvRef('password', input.password);
      if (input.port !== undefined) requireEnvRef('port', input.port);
      if (input.domain !== undefined) requireEnvRef('domain', input.domain);

      const source: MssqlSource & { port?: string; domain?: string } = {
        server: input.server,
        database: input.database,
        user: input.user,
        password: input.password,
      };
      if (input.port !== undefined) source.port = input.port;
      if (input.domain !== undefined) source.domain = input.domain;

      const cfg: DbgraphConfig = { dialect: 'mssql', source };
      return cfg;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// writeConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializes a DbgraphConfig to a committable JSON string.
 * Fixed key order: dialect, source, then optional fields (levels, driver).
 * Format: JSON.stringify(ordered, null, 2) + '\n'.
 * Deterministic: same input always produces identical bytes (ADR-008).
 */
export function writeConfig(cfg: DbgraphConfig): string {
  // Build a plain object with a FIXED key order for determinism.
  const ordered: Record<string, unknown> = {
    dialect: cfg.dialect,
    source: buildOrderedSource(cfg),
  };

  if (cfg.levels !== undefined) {
    ordered['levels'] = cfg.levels;
  }

  if (cfg.dialect === 'sqlite' && cfg.driver !== undefined) {
    ordered['driver'] = cfg.driver;
  }

  return JSON.stringify(ordered, null, 2) + '\n';
}

/**
 * Builds the source block with a deterministic key order.
 */
function buildOrderedSource(cfg: DbgraphConfig): unknown {
  if (cfg.dialect === 'sqlite') {
    return { file: cfg.source.file };
  }
  if (cfg.dialect === 'pg') {
    // pg: fixed key order (wiring completed in Batch 5)
    const src = cfg.source;
    const ordered: Record<string, unknown> = {
      host: src.host,
      database: src.database,
      user: src.user,
      password: src.password,
    };
    if (src.port !== undefined) ordered['port'] = src.port;
    if (src.ssl !== undefined) ordered['ssl'] = src.ssl;
    if (src.schema !== undefined) ordered['schema'] = src.schema;
    return ordered;
  }
  if (cfg.dialect === 'mysql') {
    // mysql: fixed key order; NO schema field (database IS the scope)
    const src = cfg.source;
    const ordered: Record<string, unknown> = {
      host: src.host,
      database: src.database,
      user: src.user,
      password: src.password,
    };
    if (src.port !== undefined) ordered['port'] = src.port;
    if (src.ssl !== undefined) ordered['ssl'] = src.ssl;
    return ordered;
  }
  if (cfg.dialect === 'mongodb') {
    // mongodb: URI-based; fixed key order; NO host/port/user/password decomposition.
    // Batch 2 stub — real wiring in Batch 5.
    const src = cfg.source;
    const ordered: Record<string, unknown> = {
      uri: src.uri,
      database: src.database,
    };
    if (src.sampleSize !== undefined) ordered['sampleSize'] = src.sampleSize;
    if (src.tls !== undefined) ordered['tls'] = src.tls;
    return ordered;
  }
  // mssql: fixed key order
  const src = cfg.source;
  const ordered: Record<string, unknown> = {
    server: src.server,
    database: src.database,
    user: src.user,
    password: src.password,
  };
  if (src.port !== undefined) ordered['port'] = src.port;
  if (src.domain !== undefined) ordered['domain'] = src.domain;
  return ordered;
}
