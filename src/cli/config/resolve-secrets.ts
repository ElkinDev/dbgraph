/**
 * resolveSecrets — expands ${env:VAR} references in a DbgraphConfig.
 * Design Decision 5, task 1.5 (phase-4-cli-config).
 * Accepts an injected env map (defaults to process.env for runtime use).
 * Unset variable → ConfigError naming the variable (never empty/partial).
 * Resolved values are returned in the config struct — NEVER logged.
 * Pure function: no process I/O, no adapter imports.
 */

import { ConfigError } from '../../core/errors.js';
import type { DbgraphConfig, SqliteSource, MssqlSource } from './schema.js';

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
  const resolved: {
    server: string;
    database: string;
    user: string;
    password: string;
    port?: string;
    domain?: string;
  } = {
    server: resolveValue(source.server, envMap),
    database: resolveValue(source.database, envMap),
    user: resolveValue(source.user, envMap),
    password: resolveValue(source.password, envMap),
  };
  if (source.port !== undefined) {
    resolved.port = resolveValue(source.port, envMap);
  }
  if (source.domain !== undefined) {
    resolved.domain = resolveValue(source.domain, envMap);
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
  }
}
