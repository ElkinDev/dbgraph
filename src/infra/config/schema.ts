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
 * Source block for a MySQL database.
 * ALL identity fields (host, database, user, password) must use
 * ${env:VAR} references for sensitive values. The plaintext-rejection rule
 * for password is enforced by parseMysqlSource when reading identity fields.
 *
 * `port` is a string in config (env-ref or literal numeric string); parse-config
 * converts the default to 3306 when absent.
 * `ssl` is optional: 'true' / 'false' literal or omitted.
 * NO `schema?` field: the connected database IS the extraction scope
 * (schema == database in MySQL; there is no schema-vs-database distinction).
 *
 * US-029 (MySQL adapter, Phase 8b), mysql-extraction spec "Connectivity via host/port".
 */
export interface MysqlSource {
  readonly host: string;
  readonly port?: string;      // parsed to number; default 3306
  readonly database: string;
  readonly user: string;
  readonly password: string;   // MUST be ${env:VAR}; rejected if literal
  readonly ssl?: string;       // 'true' | 'false' or omitted
}

/**
 * Source block for a MongoDB database.
 * Uses a URI-based connection string — NO host/port/user/password/schema
 * decomposition. The full URI (including any embedded credentials) MUST be
 * supplied as a `${env:VAR}` reference; literals are REJECTED by the parser.
 *
 * `database` names the extraction scope (also the schema name in the
 * normalized catalog — schema == database for MongoDB).
 * `sampleSize` controls per-collection document sampling; parse-config
 * defaults to 100 when absent.
 * `tls` enables TLS/SSL when true; optional.
 *
 * NO `schema?` field: the connected database IS the extraction scope.
 * NO host/port/user/password fields: all live inside the URI.
 *
 * US-030 (MongoDB adapter, Phase 9b), mongodb-extraction spec
 * "Connectivity via a URI reference".
 */
export interface MongodbSource {
  readonly uri: string;        // MUST be ${env:VAR}; literal rejected by parser
  readonly database: string;   // extraction scope; schema == database for MongoDB
  readonly sampleSize?: number; // default 100; per-collection sampling depth
  readonly tls?: boolean;      // enables TLS/SSL when true
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
    }
  | {
      readonly dialect: 'mysql';
      readonly source: MysqlSource;
      readonly levels?: Partial<ObjectTypeLevels>;
    }
  | {
      readonly dialect: 'mongodb';
      readonly source: MongodbSource;
      readonly levels?: Partial<ObjectTypeLevels>;
    };

/** Valid index level values. */
export const VALID_LEVELS = ['off', 'metadata', 'full'] as const;
export type ValidLevel = (typeof VALID_LEVELS)[number];

/** Supported dialects. */
export const SUPPORTED_DIALECTS = ['sqlite', 'mssql', 'pg', 'mysql', 'mongodb'] as const;
export type SupportedDialect = (typeof SUPPORTED_DIALECTS)[number];
