/**
 * DbgraphConfig type — the shape of dbgraph.config.json (project root).
 * Design Decision 5 (phase-4-cli-config): all connection-identity fields are
 * ${env:VAR} references only — never inline plaintext.
 * ADR-004: this file has NO adapter, driver, or core imports beyond types.
 *
 * Moved from src/cli/config/schema.ts to src/infra/config/schema.ts as part of
 * the cli↔mcp decoupling (Batch B fix, phase-5-mcp-server): src/infra/ must not
 * import src/cli/**, and open-connections.ts needs this schema.
 */

import type { ObjectTypeLevels } from '../../core/model/node.js';

/**
 * Source block for a SQLite database.
 * The file path MAY be a literal (local path) or a ${env:VAR} reference.
 * No other connection-identity fields exist for SQLite.
 */
export interface SqliteSource {
  readonly file: string;
}

/**
 * Source block for a SQL Server database.
 * ALL identity fields (server, database, user, domain, password) MUST be
 * ${env:VAR} references. The plaintext-rejection rule is enforced by
 * buildConfig / parseConfig when writing or reading identity fields.
 *
 * auth discriminant (connectivity-strategies A1.5):
 *   'sql'        — SQL Server auth (user + password required)
 *   'ntlm'       — Windows/NTLM auth (domain + user + password required)
 *   'integrated' — Windows Integrated Security; user/password/domain NOT required
 *   undefined    — inferred: domain present → 'ntlm', else → 'sql' (back-compat)
 */
export interface MssqlSource {
  readonly server: string;
  readonly port?: string;
  readonly database: string;
  readonly user?: string;
  readonly domain?: string;
  readonly password?: string;
  /** Auth mode discriminant. When absent, inferred from field presence (back-compat). */
  readonly auth?: 'sql' | 'ntlm' | 'integrated';
}

/**
 * Source block for a PostgreSQL database.
 * ALL identity fields (host, database, user, password) MUST be
 * ${env:VAR} references. The plaintext-rejection rule is enforced by
 * parsePgSource when reading these fields.
 *
 * `port` is a string in config (env-ref or literal numeric string); parse-config
 * converts it to a number (default 5432).
 * `ssl` is optional: 'true' / 'false' literal or omitted.
 * `schema` is optional: omit to extract all non-system schemas; set to scope.
 *
 * US-028 (PostgreSQL adapter), pg-extraction spec "Connectivity via host/port".
 */
export interface PgSource {
  readonly host: string;
  readonly port?: string;      // parsed to number; default 5432
  readonly database: string;
  readonly user: string;
  readonly password: string;   // MUST be ${env:VAR}; rejected if literal
  readonly ssl?: string;       // 'true' | 'false' or omitted
  readonly schema?: string;    // optional schema scope
}

/**
 * The committeable dbgraph.config.json schema.
 * dialect discriminant determines the source shape.
 */
export type DbgraphConfig =
  | {
      readonly dialect: 'sqlite';
      readonly source: SqliteSource;
      readonly levels?: Partial<ObjectTypeLevels>;
      readonly driver?: 'better-sqlite3' | 'node:sqlite';
    }
  | {
      readonly dialect: 'mssql';
      readonly source: MssqlSource;
      readonly levels?: Partial<ObjectTypeLevels>;
    }
  | {
      readonly dialect: 'pg';
      readonly source: PgSource;
      readonly levels?: Partial<ObjectTypeLevels>;
    };

/** Valid index level values. */
export const VALID_LEVELS = ['off', 'metadata', 'full'] as const;
export type ValidLevel = (typeof VALID_LEVELS)[number];

/** Supported dialects. */
export const SUPPORTED_DIALECTS = ['sqlite', 'mssql', 'pg'] as const;
export type SupportedDialect = (typeof SUPPORTED_DIALECTS)[number];
