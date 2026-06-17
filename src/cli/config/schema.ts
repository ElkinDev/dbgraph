/**
 * DbgraphConfig type — the shape of dbgraph.config.json (project root).
 * Design Decision 5 (phase-4-cli-config): all connection-identity fields are
 * ${env:VAR} references only — never inline plaintext.
 * ADR-004: this file has NO adapter, driver, or core imports beyond types.
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
 */
export interface MssqlSource {
  readonly server: string;
  readonly port?: string;
  readonly database: string;
  readonly user: string;
  readonly domain?: string;
  readonly password: string;
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
    };

/** Valid index level values. */
export const VALID_LEVELS = ['off', 'metadata', 'full'] as const;
export type ValidLevel = (typeof VALID_LEVELS)[number];

/** Supported dialects. */
export const SUPPORTED_DIALECTS = ['sqlite', 'mssql'] as const;
export type SupportedDialect = (typeof SUPPORTED_DIALECTS)[number];
