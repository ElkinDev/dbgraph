/**
 * WritableSqliteHandle — driver-agnostic seam for the SQLite graph store.
 * Design phase-9.5b: one interface consumed by schema.ts, migrations.ts,
 * and sqlite-graph-store.ts. Only factory.ts selects and wraps a concrete driver.
 *
 * ADR-004: the GraphStore PORT in src/core/ports/graph-store.ts is UNCHANGED.
 * The concrete driver (better-sqlite3 or node:sqlite) never leaks past factory.ts.
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
