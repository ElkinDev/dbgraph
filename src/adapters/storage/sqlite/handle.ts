/**
 * WritableSqliteHandle — driver-agnostic seam for the SQLite graph store.
 * Design phase-9.5b: one interface consumed by schema.ts, migrations.ts,
 * and sqlite-graph-store.ts. Only factory.ts selects and wraps a concrete driver.
 *
 * ADR-004: the GraphStore PORT in src/core/ports/graph-store.ts is UNCHANGED.
 * The concrete driver (better-sqlite3 or node:sqlite) never leaks past factory.ts.
 *
 * Phase 9.5b Batch 2: `nodeSqliteHandle` added — duck-typed over node:sqlite
 * DatabaseSync (NO unconditional import; handle is typed `unknown`).
 * `transaction` is SYNTHESIZED via BEGIN/COMMIT/ROLLBACK since node:sqlite
 * has no native `.transaction()` helper.
 */

import type { Database as BetterSqliteDb } from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// StatementHandle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal prepared-statement surface used by the store.
 * All three methods are variadic so both object-bind (`run({id})`) and
 * positional-bind (`run(a, b)`, `all(kind)`, `get(id)`) call sites work
 * without any adapter-specific overloads.
 */
export interface StatementHandle {
  run(...args: unknown[]): { changes: number };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

// ─────────────────────────────────────────────────────────────────────────────
// WritableSqliteHandle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full writable surface of the SQLite graph store.
 *
 * - `prepare(sql)` — cache a prepared statement; returns a `StatementHandle`.
 * - `exec(sql)` — run one or more DDL/DML statements with no result.
 * - `transaction<T>(fn)` — wrap `fn` in a transaction and return a CALLABLE
 *   `() => T`; callers MUST invoke the returned function separately:
 *   `const t = handle.transaction(fn); t();` — mirrors better-sqlite3 behaviour.
 * - `pragma(pragma)` — execute a write-only PRAGMA (e.g. `'journal_mode = WAL'`);
 *   return value is discarded (void).
 * - `close()` — close the underlying database connection.
 */
export interface WritableSqliteHandle {
  prepare(sql: string): StatementHandle;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  pragma(pragma: string): void;
  close(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// betterSqliteHandle — thin pass-through over better-sqlite3 Database
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a better-sqlite3 `Database` in `WritableSqliteHandle`.
 * Every call delegates directly to the native API — zero behavior change.
 *
 * `RunResult.changes` is forwarded as `{ changes }` so all call sites
 * access `.changes` uniformly regardless of driver.
 */
export function betterSqliteHandle(db: BetterSqliteDb): WritableSqliteHandle {
  return {
    prepare(sql: string): StatementHandle {
      const stmt = db.prepare(sql);
      return {
        run(...args: unknown[]): { changes: number } {
          // better-sqlite3 Statement.run() accepts (binding | ...params).
          // We spread the variadic args so both object-bind and positional-bind work.
          const info = stmt.run(...(args as Parameters<typeof stmt.run>));
          return { changes: info.changes };
        },
        get(...args: unknown[]): unknown {
          return stmt.get(...(args as Parameters<typeof stmt.get>));
        },
        all(...args: unknown[]): unknown[] {
          return stmt.all(...(args as Parameters<typeof stmt.all>)) as unknown[];
        },
      };
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    transaction<T>(fn: () => T): () => T {
      // better-sqlite3 .transaction() returns a callable that wraps fn.
      // We cast to () => T because better-sqlite3's overloads are complex but
      // our fn signature is always () => T with no extra arguments at the call sites.
      return db.transaction(fn) as unknown as () => T;
    },

    pragma(pragma: string): void {
      // better-sqlite3 pragma() accepts 'key = value' syntax directly.
      db.pragma(pragma);
    },

    close(): void {
      db.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// nodeSqliteHandle — duck-typed wrapper over node:sqlite DatabaseSync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Local duck-typed interface for a node:sqlite StatementSync.
 * Avoids unconditional import of 'node:sqlite' (only available on Node >= 22.5).
 */
interface NodeSqliteStatement {
  run(...args: unknown[]): Record<string, unknown>;
  get(...args: unknown[]): Record<string, unknown> | undefined;
  all(...args: unknown[]): Record<string, unknown>[];
}

/**
 * Local duck-typed interface for node:sqlite DatabaseSync.
 * Typed as the subset we actually use — no import of node:sqlite types.
 */
interface NodeSqliteDb {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

/**
 * Wraps a node:sqlite `DatabaseSync` instance (typed as `unknown` to avoid
 * unconditional import) in a `WritableSqliteHandle`.
 *
 * Key differences vs better-sqlite3:
 * - `StatementSync.run()` returns `{ changes, lastInsertRowid }` — we normalize to `{ changes }`.
 * - No native `.transaction()` — we SYNTHESIZE it via BEGIN/COMMIT/ROLLBACK.
 * - `pragma(s)` → `exec('PRAGMA ' + s)` (discard any echo; write-only seam).
 *
 * `:memory:` WAL caveat: `PRAGMA journal_mode = WAL` on `:memory:` is a NO-OP
 * (forced `journal_mode=memory`). This is identical on both drivers — not an error.
 *
 * @param handle - A `DatabaseSync` instance opened by the caller.
 *                 Typed `unknown` — no unconditional import of node:sqlite.
 */
export function nodeSqliteHandle(handle: unknown): WritableSqliteHandle {
  // Cast to our local duck-typed interface — the caller guarantees it's a DatabaseSync.
  const db = handle as NodeSqliteDb;

  // Helper: execute a raw SQL string against the db — used by synthesized transaction.
  function execRaw(sql: string): void {
    db.exec(sql);
  }

  return {
    prepare(sql: string): StatementHandle {
      const stmt = db.prepare(sql);
      return {
        run(...args: unknown[]): { changes: number } {
          // node:sqlite StatementSync.run() returns { changes, lastInsertRowid }.
          // We normalize to { changes } to match the StatementHandle contract.
          const result = stmt.run(...args) as { changes: number };
          return { changes: result['changes'] };
        },
        get(...args: unknown[]): unknown {
          // node:sqlite returns null-prototype objects; spread into a plain object
          // so downstream code and toStrictEqual comparisons work identically to
          // better-sqlite3 (which also returns null-prototype objects but vitest
          // normalizes those). We spread to guarantee Object.prototype presence.
          const row = stmt.get(...args);
          return row !== undefined && row !== null ? { ...row } : row;
        },
        all(...args: unknown[]): unknown[] {
          // Spread each row into a plain object (same null-prototype normalization).
          return (stmt.all(...args) as Record<string, unknown>[]).map((r) => ({ ...r }));
        },
      };
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    /**
     * Synthesized transaction: returns a CALLABLE () => T.
     * On invocation:
     *   - Issues BEGIN (deferred — safe under WAL + foreign_keys)
     *   - Calls fn()
     *   - On success: issues COMMIT, returns fn's result
     *   - On throw: issues ROLLBACK, re-throws the original error (no wrapping)
     *
     * Matches better-sqlite3's `.transaction()` call-site semantics exactly.
     */
    transaction<T>(fn: () => T): () => T {
      return (): T => {
        execRaw('BEGIN');
        try {
          const result = fn();
          execRaw('COMMIT');
          return result;
        } catch (error) {
          execRaw('ROLLBACK');
          throw error;
        }
      };
    },

    pragma(pragma: string): void {
      // node:sqlite has no `.pragma()` method — map to exec('PRAGMA ...').
      // Return value is discarded (write-only seam; callers never read the echo).
      // `:memory:` WAL no-op: `PRAGMA journal_mode = WAL` silently stays at
      // `journal_mode=memory` — this is NOT an error, and we do not throw.
      db.exec(`PRAGMA ${pragma}`);
    },

    close(): void {
      db.close();
    },
  };
}
