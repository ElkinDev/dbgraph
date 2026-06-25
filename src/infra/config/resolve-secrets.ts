/**
 * resolveSecrets — expands ${env:VAR} references in a DbgraphConfig.
 * Design Decision 5, task 1.5 (phase-4-cli-config).
 * Accepts an injected env map (defaults to process.env for runtime use).
 * Unset variable → ConfigError naming the variable (never empty/partial).
 * Resolved values are returned in the config struct — NEVER logged.
 * Pure function: no process I/O, no adapter imports.
 *
 * Moved from src/cli/config/resolve-secrets.ts to src/infra/config/resolve-secrets.ts
 * as part of the cli↔mcp decoupling (Batch B fix, phase-5-mcp-server).
 */

import { ConfigError } from '../../core/errors.js';

// Internal helper to throw a ConfigError for missing credential fields.
function missingCredential(field: string): never {
  throw new ConfigError(
    `source (mssql): field "${field}" is required for sql/ntlm authentication.`,
  );
}
import type { DbgraphConfig, SqliteSource, MssqlSource, PgSource, MysqlSource, MongodbSource } from './schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// ${env:VAR} expansion
// ─────────────────────────────────────────────────────────────────────────────

const ENV_REF_RE = /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/;

/**
 * If the value is a ${env:VAR} token, resolves it from envMap.
 * Throws ConfigError naming the variable if it is unset.
 * Non-token values are returned as-is.
 */
function resolveValue(value: string, envMap: Record<string, string | undefined>): string {
  const m = ENV_REF_RE.exec(value);
  if (m === null) {
    // Not an env reference — return literal as-is
    return value;
  }
  const varName = m[1] as string;
  const resolved = envMap[varName];
  if (resolved === undefined || resolved === '') {
    throw new ConfigError(
      `Environment variable "${varName}" is not set. ` +
        `Set it before running dbgraph (e.g. export ${varName}=<value>).`,
    );
  }
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source resolvers
// ─────────────────────────────────────────────────────────────────────────────

function resolveSqliteSource(
  source: SqliteSource,
  envMap: Record<string, string | undefined>,
): SqliteSource {
  return { file: resolveValue(source.file, envMap) };
}

function resolveMssqlSource(
  source: MssqlSource,
  envMap: Record<string, string | undefined>,
): MssqlSource {
  // integrated mode: only server + database are required; no credential fields.
  if (source.auth === 'integrated') {
    const resolved: {
      server: string;
      database: string;
      auth: 'integrated';
      port?: string;
    } = {
      server: resolveValue(source.server, envMap),
      database: resolveValue(source.database, envMap),
      auth: 'integrated',
    };
    if (source.port !== undefined) {
      resolved.port = resolveValue(source.port, envMap);
    }
    return resolved;
  }

  // sql / ntlm / inferred — all credential fields present and required.
  const resolved: {
    server: string;
    database: string;
    user: string;
    password: string;
    port?: string;
    domain?: string;
    auth?: 'sql' | 'ntlm';
  } = {
    server: resolveValue(source.server, envMap),
    database: resolveValue(source.database, envMap),
    // Guard each credential field — only resolve when present (A1.6).
    user: source.user !== undefined ? resolveValue(source.user, envMap) : missingCredential('user'),
    password: source.password !== undefined ? resolveValue(source.password, envMap) : missingCredential('password'),
  };
  if (source.port !== undefined) {
    resolved.port = resolveValue(source.port, envMap);
  }
  if (source.domain !== undefined) {
    resolved.domain = resolveValue(source.domain, envMap);
  }
  if (source.auth !== undefined) {
    resolved.auth = source.auth;
  }
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves all ${env:VAR} references in the config's source block.
 * @param cfg   - A validated DbgraphConfig (from parseConfig).
 * @param envMap - The environment to resolve from (defaults to process.env at
 *                 runtime; inject a test map in unit tests for isolation).
 * @returns A new DbgraphConfig with all ${env:VAR} tokens replaced by their
 *          resolved values. The resolved config MUST NOT be logged.
 */
export function resolveSecrets(
  cfg: DbgraphConfig,
  envMap: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): DbgraphConfig {
  switch (cfg.dialect) {
    case 'sqlite': {
      const resolvedSource = resolveSqliteSource(cfg.source, envMap);
      const result: DbgraphConfig =
        cfg.levels !== undefined
          ? cfg.driver !== undefined
            ? { dialect: 'sqlite', source: resolvedSource, levels: cfg.levels, driver: cfg.driver }
            : { dialect: 'sqlite', source: resolvedSource, levels: cfg.levels }
          : cfg.driver !== undefined
            ? { dialect: 'sqlite', source: resolvedSource, driver: cfg.driver }
            : { dialect: 'sqlite', source: resolvedSource };
      return result;
    }
    case 'mssql': {
      const resolvedSource = resolveMssqlSource(cfg.source, envMap);
      const result: DbgraphConfig =
        cfg.levels !== undefined
          ? { dialect: 'mssql', source: resolvedSource, levels: cfg.levels }
          : { dialect: 'mssql', source: resolvedSource };
      return result;
    }
    case 'pg': {
      const resolvedSource = resolvePgSource(cfg.source, envMap);
      const result: DbgraphConfig =
        cfg.levels !== undefined
          ? { dialect: 'pg', source: resolvedSource, levels: cfg.levels }
          : { dialect: 'pg', source: resolvedSource };
      return result;
    }
    case 'mysql': {
      const resolvedSource = resolveMysqlSource(cfg.source, envMap);
      const result: DbgraphConfig =
        cfg.levels !== undefined
          ? { dialect: 'mysql', source: resolvedSource, levels: cfg.levels }
          : { dialect: 'mysql', source: resolvedSource };
      return result;
    }
    case 'mongodb': {
      const resolvedSource = resolveMongodbSource(cfg.source, envMap);
      const result: DbgraphConfig =
        cfg.levels !== undefined
          ? { dialect: 'mongodb', source: resolvedSource, levels: cfg.levels }
          : { dialect: 'mongodb', source: resolvedSource };
      return result;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MysqlSource resolver (added by phase-8b-mysql Batch 2)
// ─────────────────────────────────────────────────────────────────────────────

function resolveMysqlSource(
  source: MysqlSource,
  envMap: Record<string, string | undefined>,
): MysqlSource {
  const resolved: {
    host: string;
    database: string;
    user: string;
    password: string;
    port?: string;
    ssl?: string;
  } = {
    host: resolveValue(source.host, envMap),
    database: resolveValue(source.database, envMap),
    user: resolveValue(source.user, envMap),
    password: resolveValue(source.password, envMap),
  };
  if (source.port !== undefined) resolved.port = resolveValue(source.port, envMap);
  if (source.ssl !== undefined) resolved.ssl = resolveValue(source.ssl, envMap);
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// PgSource resolver (added by phase-8a-pg Batch 2)
// ─────────────────────────────────────────────────────────────────────────────

function resolvePgSource(
  source: PgSource,
  envMap: Record<string, string | undefined>,
): PgSource {
  const resolved: {
    host: string;
    database: string;
    user: string;
    password: string;
    port?: string;
    ssl?: string;
    schema?: string;
  } = {
    host: resolveValue(source.host, envMap),
    database: resolveValue(source.database, envMap),
    user: resolveValue(source.user, envMap),
    password: resolveValue(source.password, envMap),
  };
  if (source.port !== undefined) resolved.port = resolveValue(source.port, envMap);
  if (source.ssl !== undefined) resolved.ssl = resolveValue(source.ssl, envMap);
  if (source.schema !== undefined) resolved.schema = resolveValue(source.schema, envMap);
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// MongodbSource resolver (added by phase-9b-mongodb Batch 2, task 2.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the ${env:VAR} URI reference in a MongodbSource.
 * The URI is the sole credential-bearing field (no host/port/user/password
 * decomposition). All other fields (database, sampleSize?, tls?) are
 * plain values that are passed through unchanged.
 *
 * Spec: "the URI ${env:VAR} is resolved env-only" (phase-9b-mongodb task 2.6).
 */
function resolveMongodbSource(
  source: MongodbSource,
  envMap: Record<string, string | undefined>,
): MongodbSource {
  const resolved: {
    uri: string;
    database: string;
    sampleSize?: number;
    tls?: boolean;
  } = {
    uri: resolveValue(source.uri, envMap),
    database: source.database,
  };
  if (source.sampleSize !== undefined) resolved.sampleSize = source.sampleSize;
  if (source.tls !== undefined) resolved.tls = source.tls;
  return resolved;
}
