/**
 * RED+GREEN tests for WritableSqliteHandle, StatementHandle, and betterSqliteHandle.
 * Phase 9.5b Batch 1 — Task 1.1.
 *
 * Uses REAL better-sqlite3 with in-memory databases (never mock the driver).
 * Spec scenario: "The store depends on the handle, not a concrete driver"
 * (handle-surface half).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { betterSqliteHandle } from '../../../../src/adapters/storage/sqlite/handle.js';
import type { WritableSqliteHandle } from '../../../../src/adapters/storage/sqlite/handle.js';

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
