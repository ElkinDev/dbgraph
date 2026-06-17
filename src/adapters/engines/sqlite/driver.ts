/**
 * ReadonlyDriver abstraction — engine-local seam that allows extraction and
 * fingerprint logic to run on EITHER better-sqlite3 OR node:sqlite without
 * duplicating query code.
 *
 * Design §3 "Driver abstraction — minimal shared sqlite-driver handle".
 * Two adapters: betterSqliteDriver(handle) + nodeSqliteDriver(handle).
 * Extraction code talks ONLY to ReadonlyDriver, so one logic path covers both.
 *
 * This file is engine-LOCAL — it does NOT touch src/adapters/storage/ which
 * talks to better-sqlite3 directly (YAGNI: shared driver is premature).
 */

import type { Database as BetterSqliteDb } from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// ReadonlyDriver interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal read-only handle shared by all driver adapters.
 * `all`  — execute a SELECT and return all rows as plain objects.
 * `pragma` — execute a PRAGMA and return the table-form result rows.
 * `close` — release the connection.
 */
export interface ReadonlyDriver {
  all(sql: string, ...params: unknown[]): readonly Record<string, unknown>[];
  pragma(name: string): readonly Record<string, unknown>[];
  close(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// better-sqlite3 adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a better-sqlite3 Database handle in the ReadonlyDriver interface.
 * The handle MUST already be opened (readonly or writable — the caller decides).
 */
export function betterSqliteDriver(db: BetterSqliteDb): ReadonlyDriver {
  return {
    all(sql: string, ...params: unknown[]): readonly Record<string, unknown>[] {
      return db.prepare(sql).all(...params) as readonly Record<string, unknown>[];
    },

    pragma(name: string): readonly Record<string, unknown>[] {
      // better-sqlite3's pragma() returns the table form when called with {simple:false}
      // or a plain value for single-value pragmas. We need table form always.
      // The safest cross-pragma approach is to use prepare + all so the output is
      // always an array of objects regardless of pragma arity.
      return db.prepare(`PRAGMA ${name}`).all() as readonly Record<string, unknown>[];
    },

    close(): void {
      db.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// node:sqlite adapter (Node >= 22.5 only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a node:sqlite DatabaseSync handle in the ReadonlyDriver interface.
 * `handle` is typed as `unknown` because node:sqlite typings are only available
 * on Node >= 22 and we cannot import them unconditionally (CI runs Node 20).
 * The caller is responsible for passing a valid DatabaseSync instance.
 */
export function nodeSqliteDriver(handle: unknown): ReadonlyDriver {
  // node:sqlite DatabaseSync has a synchronous API close to better-sqlite3.
  // We use duck-typing via a local interface so we avoid importing node:sqlite types.
  const db = handle as {
    prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] };
    close(): void;
  };

  return {
    all(sql: string, ...params: unknown[]): readonly Record<string, unknown>[] {
      return db.prepare(sql).all(...params);
    },

    pragma(name: string): readonly Record<string, unknown>[] {
      return db.prepare(`PRAGMA ${name}`).all();
    },

    close(): void {
      db.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Node version detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the current Node.js runtime supports node:sqlite.
 * node:sqlite was added in Node 22.5.0 (experimental) and is stable from 23+.
 * We check the version string rather than attempting a dynamic import so the
 * detection is synchronous and free of side effects.
 */
export function isNodeSqliteAvailable(): boolean {
  const version = process.versions['node'] ?? '0.0.0';
  const parts = version.split('.');
  const major = parseInt(parts[0] ?? '0', 10);
  const minor = parseInt(parts[1] ?? '0', 10);
  return major > 22 || (major === 22 && minor >= 5);
}
