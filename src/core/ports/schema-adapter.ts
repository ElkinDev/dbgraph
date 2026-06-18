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
 * Union of all engine-specific config shapes.
 * Future engines add their own member without touching existing members.
 * Each engine keeps its OWN factory taking its concrete config type directly —
 * no runtime discriminant is needed at the union level.
 */
export type SchemaAdapterConfig = SqliteAdapterConfig | MssqlAdapterConfig;

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
