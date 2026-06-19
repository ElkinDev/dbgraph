/**
 * SchemaAdapter port — the driving port for source-database schema extraction.
 * Design §1 "SchemaAdapter port shape" — async lifecycle symmetric with GraphStore.
 * This file imports NOTHING from adapters, drivers, mcp, or cli (ADR-004).
 * The concrete join to a driver lives in src/adapters/engines/<engine>/.
 *
 * US-026 (first concrete adapter), US-031 (read-only by construction),
 * US-009 (per-engine fingerprint).
 */

import type { CapabilityMatrix, ExtractionScope } from '../model/capability.js';
import type { RawCatalog } from '../model/catalog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Config types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for the SQLite schema adapter.
 * `file` is the path to the source .db file (or ':memory:' for tests).
 * `driver` selects the driver explicitly; defaults to `better-sqlite3`.
 * NO silent auto-fallback — design §2 "Driver selection is explicit".
 */
export interface SqliteAdapterConfig {
  readonly file: string;
  readonly driver?: 'better-sqlite3' | 'node:sqlite';
}

/**
 * Configuration for the Microsoft SQL Server schema adapter.
 * Structural union member — distinguished from SqliteAdapterConfig by the
 * presence of `server`, `database`, and `authentication` (no `dialect` field
 * needed; each engine keeps its own factory taking its concrete config type).
 *
 * authentication.type 'sql'      — SQL Server authentication (user + password).
 * authentication.type 'ntlm'     — Windows/NTLM authentication (domain + user + password).
 * authentication.type 'integrated' — Windows Integrated Security; NO credentials required.
 *                                    The current OS session identity is used (ADR-006 note:
 *                                    tedious cannot handle this; the strategy registry will
 *                                    skip the native strategy and use an external tool instead).
 *
 * US-027 (SQL Server adapter), ADR-007 (no new generic config shape).
 * connectivity-strategies A1.4: integrated member added additively.
 */
export interface MssqlAdapterConfig {
  readonly server: string;
  readonly port?: number;          // default 1433
  readonly database: string;
  readonly authentication:
    | { readonly type: 'sql'; readonly user: string; readonly password: string }
    | {
        readonly type: 'ntlm';
        readonly domain: string;
        readonly user: string;
        readonly password: string;
      }
    | { readonly type: 'integrated' };  // no user/password/domain — current Windows session
  readonly encrypt?: boolean;              // default true (recommended for production)
  readonly trustServerCertificate?: boolean; // default true for dev; set false in production
}

/**
 * Configuration for the PostgreSQL schema adapter.
 *
 * IMPORTANT — union discriminability: These config shapes are NOT discriminable
 * by structure alone (both PgAdapterConfig and MysqlAdapterConfig carry `host`).
 * The union is a plain structural union for typing only; runtime dispatch is by
 * the EXPLICIT config `dialect` field in parse-config.ts / open-connections.ts,
 * and each engine factory takes its own concrete config type directly.
 * No `dialect` discriminant is added to the union members.
 *
 * `password` MUST be supplied as a `${env:VAR}` reference — never a literal.
 * `port` defaults to 5432 when omitted.
 * `schema` is optional: omit to extract all non-system schemas; supply to scope
 * extraction to a single schema.
 *
 * US-028 (PostgreSQL adapter), pg-extraction spec "Connectivity via host/port".
 */
export interface PgAdapterConfig {
  readonly host: string;
  readonly port?: number;            // default 5432
  readonly database: string;
  readonly user: string;
  readonly password: string;         // resolved from ${env:VAR}; literals REJECTED by parser
  readonly ssl?: boolean | { readonly rejectUnauthorized?: boolean };
  readonly schema?: string;          // omit = all non-system schemas; set = scoped
}

/**
 * Configuration for the MySQL schema adapter.
 *
 * IMPORTANT — union discriminability: Both PgAdapterConfig and MysqlAdapterConfig
 * carry `host`; the union is intentionally NON-discriminable by structural shape.
 * Runtime dispatch keys on the EXPLICIT config `dialect` field in parse-config.ts
 * and open-connections.ts. Each engine factory takes its own concrete config type
 * directly. No `dialect` discriminant is added to union members.
 *
 * `password` MUST be supplied as a `${env:VAR}` reference — never a literal.
 * `port` defaults to 3306 when omitted.
 * NO `schema?` field: the connected `database` IS the extraction scope
 * (schema == database in MySQL — there is no schema-vs-database distinction).
 *
 * US-029 (MySQL adapter, Phase 8b), mysql-extraction spec "Connectivity via host/port".
 */
export interface MysqlAdapterConfig {
  readonly host: string;
  readonly port?: number;            // default 3306
  readonly database: string;         // the connected database IS the schema scope; no schema? knob
  readonly user: string;
  readonly password: string;         // resolved from ${env:VAR}; literals REJECTED by parser
  readonly ssl?: boolean | { readonly rejectUnauthorized?: boolean };
}

/**
 * Union of all engine-specific config shapes.
 *
 * This is a STRUCTURAL union for typing only — it is intentionally
 * NON-discriminable by shape (pg and mysql both carry `host`; sqlite uses `file`;
 * mssql uses `server`). Runtime dispatch is by the EXPLICIT config `dialect` field
 * in parse-config.ts / open-connections.ts; each engine factory takes its own
 * concrete config type directly. No `dialect` discriminant is added to members.
 *
 * Future engines add their own member without touching existing members.
 */
export type SchemaAdapterConfig =
  | SqliteAdapterConfig
  | MssqlAdapterConfig
  | PgAdapterConfig
  | MysqlAdapterConfig;

// ─────────────────────────────────────────────────────────────────────────────
// SchemaAdapter port
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The driven port every source-database adapter MUST implement.
 *
 * Lifecycle:
 *   createXxxSchemaAdapter(config) → already-open SchemaAdapter
 *   extract(scope) / fingerprint()  ← may be called any number of times
 *   close()                         ← idempotent; a second call MUST NOT throw
 *
 * The `open` step is handled by the FACTORY (mirrors createSqliteGraphStore),
 * so this port exposes no `open()` method.
 */
export interface SchemaAdapter {
  /** Stable engine identifier, e.g. 'sqlite', 'mssql', 'pg'. */
  readonly dialect: string;

  /**
   * Truthful capability matrix for this engine.
   * Declares which NodeKind types are extractable, whether bodies are available,
   * and whether dependency hints are supported.
   */
  readonly capabilities: CapabilityMatrix;

  /**
   * Extract the source database's schema into a RawCatalog.
   * Honours the ExtractionScope levels (off / metadata / full).
   * Returns a value consumable by normalizeCatalog without any adapter import.
   */
  extract(scope: ExtractionScope): Promise<RawCatalog>;

  /**
   * Compute a cheap drift fingerprint for the current schema.
   * MUST change on DDL changes; MUST be stable across data-only changes (US-009).
   * Issues exactly ONE catalog query — does NOT walk all objects.
   */
  fingerprint(): Promise<string>;

  /**
   * Release the connection. Idempotent — a second call MUST NOT throw.
   */
  close(): Promise<void>;
}
