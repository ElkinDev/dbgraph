/**
 * parseConfig — validates a raw JSON value and returns a DbgraphConfig.
 * Design Decision 5, task 1.4 (phase-4-cli-config).
 * Throws ConfigError on malformed input (names the offending field).
 * Throws UnsupportedDialectError on unknown dialect.
 * No driver imports; no process I/O; pure function.
 *
 * Moved from src/cli/config/parse-config.ts to src/infra/config/parse-config.ts
 * as part of the cli↔mcp decoupling (Batch B fix, phase-5-mcp-server).
 */

import { ConfigError, UnsupportedDialectError } from '../../core/errors.js';
import {
  type DbgraphConfig,
  type SqliteSource,
  type MssqlSource,
  VALID_LEVELS,
  SUPPORTED_DIALECTS,
} from './schema.js';
import type { ObjectTypeLevels } from '../../core/model/node.js';

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, field: string, context: string): string {
  const v = obj[field];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ConfigError(
      `${context}: field "${field}" is required and must be a non-empty string.`,
    );
  }
  return v;
}

function optionalString(
  obj: Record<string, unknown>,
  field: string,
  context: string,
): string | undefined {
  const v = obj[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    throw new ConfigError(`${context}: field "${field}" must be a string when provided.`);
  }
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Levels validation
// ─────────────────────────────────────────────────────────────────────────────

function parseLevels(raw: unknown): Partial<ObjectTypeLevels> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new ConfigError(
      'Config: "levels" must be an object mapping object type names to level strings.',
    );
  }
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!VALID_LEVELS.includes(val as (typeof VALID_LEVELS)[number])) {
      throw new ConfigError(
        `Config: levels."${key}" must be one of ${VALID_LEVELS.join(', ')} — got "${String(val)}".`,
      );
    }
    result[key] = val as string;
  }
  return result as Partial<ObjectTypeLevels>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source parsers
// ─────────────────────────────────────────────────────────────────────────────

function parseSqliteSource(raw: unknown): SqliteSource {
  if (!isRecord(raw)) {
    throw new ConfigError('Config: "source" must be an object for dialect "sqlite".');
  }
  const file = requireString(raw, 'file', 'source (sqlite)');
  return { file };
}

function parseMssqlSource(raw: unknown): MssqlSource {
  if (!isRecord(raw)) {
    throw new ConfigError('Config: "source" must be an object for dialect "mssql".');
  }
  const server = requireString(raw, 'server', 'source (mssql)');
  const database = requireString(raw, 'database', 'source (mssql)');
  const user = requireString(raw, 'user', 'source (mssql)');
  const password = requireString(raw, 'password', 'source (mssql)');
  const port = optionalString(raw, 'port', 'source (mssql)');
  const domain = optionalString(raw, 'domain', 'source (mssql)');

  const result: {
    server: string;
    database: string;
    user: string;
    password: string;
    port?: string;
    domain?: string;
  } = { server, database, user, password };

  if (port !== undefined) result.port = port;
  if (domain !== undefined) result.domain = domain;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a raw JSON value and returns a typed DbgraphConfig.
 * Throws ConfigError on malformed input (names the offending field).
 * Throws UnsupportedDialectError for unknown dialect values.
 */
export function parseConfig(raw: unknown): DbgraphConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(
      'Config: root must be a JSON object. Got ' + (raw === null ? 'null' : typeof raw) + '.',
    );
  }

  const dialectRaw = raw['dialect'];
  if (typeof dialectRaw !== 'string' || dialectRaw.length === 0) {
    throw new ConfigError(
      'Config: field "dialect" is required and must be a non-empty string ' +
        `(supported: ${SUPPORTED_DIALECTS.join(', ')}).`,
    );
  }

  // Unknown dialect → UnsupportedDialectError
  if (!SUPPORTED_DIALECTS.includes(dialectRaw as (typeof SUPPORTED_DIALECTS)[number])) {
    throw new UnsupportedDialectError(dialectRaw);
  }

  if (!('source' in raw)) {
    throw new ConfigError('Config: field "source" is required.');
  }

  const levels = parseLevels(raw['levels']);

  switch (dialectRaw) {
    case 'sqlite': {
      const source = parseSqliteSource(raw['source']);
      const driverRaw = raw['driver'];
      let driver: 'better-sqlite3' | 'node:sqlite' | undefined;
      if (driverRaw !== undefined) {
        if (driverRaw !== 'better-sqlite3' && driverRaw !== 'node:sqlite') {
          throw new ConfigError(
            'Config: "driver" must be one of "better-sqlite3" or "node:sqlite".',
          );
        }
        driver = driverRaw;
      }
      const cfg: DbgraphConfig = levels !== undefined
        ? driver !== undefined
          ? { dialect: 'sqlite', source, levels, driver }
          : { dialect: 'sqlite', source, levels }
        : driver !== undefined
          ? { dialect: 'sqlite', source, driver }
          : { dialect: 'sqlite', source };
      return cfg;
    }
    case 'mssql': {
      const source = parseMssqlSource(raw['source']);
      const cfg: DbgraphConfig = levels !== undefined
        ? { dialect: 'mssql', source, levels }
        : { dialect: 'mssql', source };
      return cfg;
    }
    default:
      throw new UnsupportedDialectError(dialectRaw);
  }
}
