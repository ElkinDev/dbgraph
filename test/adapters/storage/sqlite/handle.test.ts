/**
 * RED+GREEN tests for WritableSqliteHandle, StatementHandle, betterSqliteHandle,
 * and nodeSqliteHandle.
 * Phase 9.5b Batch 1 — Task 1.1.
 * Phase 9.5b Batch 2 — Tasks 2.1, 2.2.
 *
 * Uses REAL better-sqlite3 and REAL node:sqlite DatabaseSync (never mock the driver).
 * node:sqlite tests gated with describe.skipIf(!isNodeSqliteAvailable()).
 * Spec scenarios:
 *   "The store depends on the handle, not a concrete driver" (handle-surface half)
 *   "node:sqlite handle has no unconditional import"
 *   "Commit on normal return (both drivers)"
 *   "Rollback on throw leaves no partial writes (both drivers)"
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { betterSqliteHandle, nodeSqliteHandle } from '../../../../src/adapters/storage/sqlite/handle.js';
import type { WritableSqliteHandle } from '../../../../src/adapters/storage/sqlite/handle.js';
import { isNodeSqliteAvailable } from '../../../../src/adapters/engines/sqlite/driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function openHandle(): WritableSqliteHandle {
  const db = new Database(':memory:');
  return betterSqliteHandle(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// betterSqliteHandle — pass-through surface
// ─────────────────────────────────────────────────────────────────────────────

describe('betterSqliteHandle — pass-through surface (task 1.1)', () => {
  describe('exec(ddl) runs DDL without error', () => {
    it('creates a table via exec', () => {
      const h = openHandle();
      expect(() => {
        h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT NOT NULL)');
      }).not.toThrow();
      h.close();
    });
  });

  describe('pragma(name) returns void and does not throw', () => {
    it('pragma journal_mode = WAL is void and does not throw', () => {
      const h = openHandle();
      const result = h.pragma('journal_mode = WAL');
      expect(result).toBeUndefined();
      h.close();
    });

    it('pragma foreign_keys = ON is void and does not throw', () => {
      const h = openHandle();
      const result = h.pragma('foreign_keys = ON');
      expect(result).toBeUndefined();
      h.close();
    });
  });

  describe('prepare(sql).run() — object bind (@named)', () => {
    it('run({k: v}) returns { changes: number }', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
      const stmt = h.prepare('INSERT INTO t (k, v) VALUES (@k, @v)');
      const result = stmt.run({ k: 'hello', v: 'world' });
      expect(typeof result.changes).toBe('number');
      expect(result.changes).toBe(1);
      h.close();
    });
  });

  describe('prepare(sql).run() — positional binds', () => {
    it('run(a, b) with positional ? binds returns { changes }', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (a TEXT, b TEXT)');
      const stmt = h.prepare('INSERT INTO t (a, b) VALUES (?, ?)');
      const result = stmt.run('foo', 'bar');
      expect(result.changes).toBe(1);
      h.close();
    });

    it('run() on DELETE returns { changes } reflecting deleted count', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      h.prepare('INSERT INTO t (id) VALUES (?)').run('x');
      const del = h.prepare('DELETE FROM t WHERE id = ?');
      const result = del.run('x');
      expect(result.changes).toBe(1);
      h.close();
    });
  });

  describe('prepare(sql).all() — positional', () => {
    it('all(kind) returns all matching rows', () => {
      const h = openHandle();
      h.exec('CREATE TABLE nodes (id TEXT, kind TEXT)');
      h.prepare('INSERT INTO nodes VALUES (?, ?)').run('n1', 'table');
      h.prepare('INSERT INTO nodes VALUES (?, ?)').run('n2', 'view');
      h.prepare('INSERT INTO nodes VALUES (?, ?)').run('n3', 'table');
      const rows = h.prepare('SELECT * FROM nodes WHERE kind = ?').all('table');
      expect(rows.length).toBe(2);
      h.close();
    });
  });

  describe('prepare(sql).get() — positional', () => {
    it('get(id) returns the matching row', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)');
      h.prepare('INSERT INTO t VALUES (?, ?)').run('id1', 'v1');
      const row = h.prepare('SELECT * FROM t WHERE id = ?').get('id1') as { id: string; val: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.id).toBe('id1');
      expect(row?.val).toBe('v1');
      h.close();
    });

    it('get() returns undefined when no row matches', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const row = h.prepare('SELECT * FROM t WHERE id = ?').get('missing');
      expect(row).toBeUndefined();
      h.close();
    });
  });

  describe('transaction(fn) returns a CALLABLE that commits on invocation', () => {
    it('returned function is callable and commits the transaction', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const insert = h.transaction(() => {
        h.prepare('INSERT INTO t VALUES (?)').run('row1');
        h.prepare('INSERT INTO t VALUES (?)').run('row2');
      });
      // Must be callable — call it now
      insert();
      const rows = h.prepare('SELECT * FROM t').all();
      expect(rows.length).toBe(2);
      h.close();
    });

    it('transaction is callable multiple times (idempotent per invocation)', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)');
      let counter = 0;
      const inc = h.transaction(() => {
        counter++;
        h.prepare('INSERT INTO t DEFAULT VALUES').run();
      });
      inc();
      inc();
      expect(counter).toBe(2);
      const rows = h.prepare('SELECT * FROM t').all();
      expect(rows.length).toBe(2);
      h.close();
    });

    it('transaction fn return value is forwarded through the callable', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const insert = h.transaction((): string => {
        h.prepare('INSERT INTO t VALUES (?)').run('x');
        return 'committed';
      });
      const value = insert();
      expect(value).toBe('committed');
      h.close();
    });

    it('transaction rolls back and re-throws when fn throws', () => {
      const h = openHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const failing = h.transaction(() => {
        h.prepare('INSERT INTO t VALUES (?)').run('partial');
        throw new Error('forced failure');
      });
      expect(() => failing()).toThrow('forced failure');
      const rows = h.prepare('SELECT * FROM t').all();
      expect(rows.length).toBe(0);
      h.close();
    });
  });

  describe('close() closes the database', () => {
    it('close() does not throw', () => {
      const h = openHandle();
      expect(() => h.close()).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.1 — nodeSqliteHandle — pass-through surface (gated on Node >= 22.5)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!isNodeSqliteAvailable())(
  'nodeSqliteHandle — pass-through surface (task 2.1)',
  async () => {
    async function openNodeHandle(): Promise<WritableSqliteHandle> {
      const mod = await import('node:sqlite' as string);
      const DatabaseSync = (mod as Record<string, unknown>)['DatabaseSync'] as new(path: string) => unknown;
      const db = new DatabaseSync(':memory:');
      return nodeSqliteHandle(db);
    }

    it('exec(ddl) runs DDL without error', async () => {
      const h = await openNodeHandle();
      expect(() => {
        h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT NOT NULL)');
      }).not.toThrow();
      h.close();
    });

    it('pragma returns void and does not throw', async () => {
      const h = await openNodeHandle();
      const result = h.pragma('foreign_keys = ON');
      expect(result).toBeUndefined();
      h.close();
    });

    it('prepare(sql).run() with object bind returns { changes: number }', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
      const stmt = h.prepare('INSERT INTO t (k, v) VALUES (@k, @v)');
      const result = stmt.run({ k: 'hello', v: 'world' });
      expect(typeof result.changes).toBe('number');
      expect(result.changes).toBe(1);
      h.close();
    });

    it('prepare(sql).run() with positional binds returns { changes }', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE t (a TEXT, b TEXT)');
      const stmt = h.prepare('INSERT INTO t (a, b) VALUES (?, ?)');
      const result = stmt.run('foo', 'bar');
      expect(result.changes).toBe(1);
      h.close();
    });

    it('prepare(sql).all() returns all matching rows', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE nodes (id TEXT, kind TEXT)');
      h.prepare('INSERT INTO nodes VALUES (?, ?)').run('n1', 'table');
      h.prepare('INSERT INTO nodes VALUES (?, ?)').run('n2', 'view');
      h.prepare('INSERT INTO nodes VALUES (?, ?)').run('n3', 'table');
      const rows = h.prepare('SELECT * FROM nodes WHERE kind = ?').all('table');
      expect(rows.length).toBe(2);
      h.close();
    });

    it('prepare(sql).get() returns matching row', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)');
      h.prepare('INSERT INTO t VALUES (?, ?)').run('id1', 'v1');
      const row = h.prepare('SELECT * FROM t WHERE id = ?').get('id1') as { id: string; val: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.id).toBe('id1');
      expect(row?.val).toBe('v1');
      h.close();
    });

    it('prepare(sql).get() returns undefined when no row matches', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const row = h.prepare('SELECT * FROM t WHERE id = ?').get('missing');
      expect(row).toBeUndefined();
      h.close();
    });

    it('transaction(fn) returns a CALLABLE that commits on invocation', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const insert = h.transaction(() => {
        h.prepare('INSERT INTO t VALUES (?)').run('row1');
        h.prepare('INSERT INTO t VALUES (?)').run('row2');
      });
      insert();
      const rows = h.prepare('SELECT * FROM t').all();
      expect(rows.length).toBe(2);
      h.close();
    });

    it('transaction fn return value is forwarded through the callable', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const insert = h.transaction((): string => {
        h.prepare('INSERT INTO t VALUES (?)').run('x');
        return 'committed';
      });
      const value = insert();
      expect(value).toBe('committed');
      h.close();
    });

    it('close() does not throw', async () => {
      const h = await openNodeHandle();
      expect(() => h.close()).not.toThrow();
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.2 — transaction COMMIT + ROLLBACK-on-throw for BOTH handles
// Spec scenarios: "Commit on normal return (both drivers)"
//                 "Rollback on throw leaves no partial writes (both drivers)"
// ─────────────────────────────────────────────────────────────────────────────

describe('transaction COMMIT — betterSqliteHandle (task 2.2)', () => {
  it('committed rows are visible after transaction on better-sqlite3', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const h = betterSqliteHandle(db);
    h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)');

    const insert = h.transaction(() => {
      h.prepare('INSERT INTO t VALUES (?, ?)').run('r1', 'v1');
      h.prepare('INSERT INTO t VALUES (?, ?)').run('r2', 'v2');
    });
    insert();

    const rows = h.prepare('SELECT * FROM t ORDER BY id').all() as Array<{ id: string; val: string }>;
    expect(rows.length).toBe(2);
    expect(rows[0]?.id).toBe('r1');
    expect(rows[1]?.id).toBe('r2');
    h.close();
  });
});

describe('transaction ROLLBACK-on-throw — betterSqliteHandle (task 2.2)', () => {
  it('failed transaction leaves no partial writes on better-sqlite3', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const h = betterSqliteHandle(db);
    h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)');

    const failing = h.transaction(() => {
      h.prepare('INSERT INTO t VALUES (?, ?)').run('partial', 'data');
      throw new Error('deliberate rollback');
    });

    // Must re-throw the original error
    expect(() => failing()).toThrow('deliberate rollback');
    // No partial writes
    const rows = h.prepare('SELECT * FROM t').all();
    expect(rows.length).toBe(0);
    h.close();
  });

  it('original error type propagates (not wrapped) on better-sqlite3', () => {
    const db = new Database(':memory:');
    const h = betterSqliteHandle(db);
    h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

    class MyError extends Error { code = 'MY_ERR'; }
    const failing = h.transaction(() => {
      throw new MyError('typed error');
    });

    let caught: unknown;
    try { failing(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(MyError);
    h.close();
  });
});

describe.skipIf(!isNodeSqliteAvailable())(
  'transaction COMMIT — nodeSqliteHandle (task 2.2)',
  async () => {
    async function openNodeHandle(): Promise<WritableSqliteHandle> {
      const mod = await import('node:sqlite' as string);
      const DatabaseSync = (mod as Record<string, unknown>)['DatabaseSync'] as new(path: string) => unknown;
      const db = new DatabaseSync(':memory:');
      return nodeSqliteHandle(db);
    }

    it('committed rows are visible after transaction on node:sqlite', async () => {
      const h = await openNodeHandle();
      h.pragma('foreign_keys = ON');
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)');

      const insert = h.transaction(() => {
        h.prepare('INSERT INTO t VALUES (?, ?)').run('r1', 'v1');
        h.prepare('INSERT INTO t VALUES (?, ?)').run('r2', 'v2');
      });
      insert();

      const rows = h.prepare('SELECT * FROM t ORDER BY id').all() as Array<{ id: string; val: string }>;
      expect(rows.length).toBe(2);
      expect(rows[0]?.id).toBe('r1');
      expect(rows[1]?.id).toBe('r2');
      h.close();
    });

    it('committed state is identical across both drivers', async () => {
      // better-sqlite3
      const db1 = new Database(':memory:');
      const h1 = betterSqliteHandle(db1);
      h1.pragma('foreign_keys = ON');
      h1.exec('CREATE TABLE t (id TEXT, val TEXT)');
      const ins1 = h1.transaction(() => {
        h1.prepare('INSERT INTO t VALUES (?, ?)').run('x', 'y');
      });
      ins1();
      const rows1 = h1.prepare('SELECT * FROM t').all() as Array<{ id: string; val: string }>;

      // node:sqlite
      const h2 = await openNodeHandle();
      h2.pragma('foreign_keys = ON');
      h2.exec('CREATE TABLE t (id TEXT, val TEXT)');
      const ins2 = h2.transaction(() => {
        h2.prepare('INSERT INTO t VALUES (?, ?)').run('x', 'y');
      });
      ins2();
      const rows2 = h2.prepare('SELECT * FROM t').all() as Array<{ id: string; val: string }>;

      expect(rows2).toStrictEqual(rows1);
      h1.close();
      h2.close();
    });
  },
);

describe.skipIf(!isNodeSqliteAvailable())(
  'transaction ROLLBACK-on-throw — nodeSqliteHandle (task 2.2)',
  async () => {
    async function openNodeHandle(): Promise<WritableSqliteHandle> {
      const mod = await import('node:sqlite' as string);
      const DatabaseSync = (mod as Record<string, unknown>)['DatabaseSync'] as new(path: string) => unknown;
      const db = new DatabaseSync(':memory:');
      return nodeSqliteHandle(db);
    }

    it('failed transaction leaves no partial writes on node:sqlite', async () => {
      const h = await openNodeHandle();
      h.pragma('foreign_keys = ON');
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)');

      const failing = h.transaction(() => {
        h.prepare('INSERT INTO t VALUES (?, ?)').run('partial', 'data');
        throw new Error('deliberate rollback');
      });

      expect(() => failing()).toThrow('deliberate rollback');
      const rows = h.prepare('SELECT * FROM t').all();
      expect(rows.length).toBe(0);
      h.close();
    });

    it('original error type propagates (not wrapped) on node:sqlite', async () => {
      const h = await openNodeHandle();
      h.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

      class MyError extends Error { code = 'MY_ERR'; }
      const failing = h.transaction(() => {
        throw new MyError('typed error');
      });

      let caught: unknown;
      try { failing(); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(MyError);
      h.close();
    });

    it('post-rollback state is identical across both drivers (empty)', async () => {
      // better-sqlite3
      const db1 = new Database(':memory:');
      const h1 = betterSqliteHandle(db1);
      h1.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const fail1 = h1.transaction(() => {
        h1.prepare('INSERT INTO t VALUES (?)').run('gone');
        throw new Error('rollback');
      });
      try { fail1(); } catch { /* expected */ }
      const rows1 = h1.prepare('SELECT * FROM t').all();

      // node:sqlite
      const h2 = await openNodeHandle();
      h2.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const fail2 = h2.transaction(() => {
        h2.prepare('INSERT INTO t VALUES (?)').run('gone');
        throw new Error('rollback');
      });
      try { fail2(); } catch { /* expected */ }
      const rows2 = h2.prepare('SELECT * FROM t').all();

      expect(rows2).toStrictEqual(rows1);
      expect(rows2.length).toBe(0);
      h1.close();
      h2.close();
    });
  },
);
