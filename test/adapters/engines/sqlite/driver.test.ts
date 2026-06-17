/**
 * Tests for ReadonlyDriver abstraction and node-version detection.
 * Design §3 "Driver abstraction — minimal shared sqlite-driver handle".
 * Story: sqlite-extraction "Driver duality" (US-026).
 * TDD: RED → fails until src/adapters/engines/sqlite/driver.ts is created.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  betterSqliteDriver,
  isNodeSqliteAvailable,
} from '../../../../src/adapters/engines/sqlite/driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const tmpPath = join(tmpdir(), `dbgraph-driver-test-${Date.now()}.db`);

function buildTestDb(): void {
  const db = new Database(tmpPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS widgets (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      qty  INTEGER DEFAULT 0
    );
    INSERT INTO widgets (name, qty) VALUES ('bolt', 100), ('nut', 200);
  `);
  db.close();
}

buildTestDb();

afterAll(() => {
  if (existsSync(tmpPath)) unlinkSync(tmpPath);
});

// ─────────────────────────────────────────────────────────────────────────────
// betterSqliteDriver — all()
// ─────────────────────────────────────────────────────────────────────────────

describe('betterSqliteDriver — all()', () => {
  it('returns all rows from a simple SELECT', () => {
    const db = new Database(tmpPath, { readonly: true });
    const driver = betterSqliteDriver(db);

    const rows = driver.all('SELECT id, name, qty FROM widgets ORDER BY id');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'bolt', qty: 100 });
    expect(rows[1]).toMatchObject({ name: 'nut', qty: 200 });

    db.close();
  });

  it('returns an empty array when no rows match', () => {
    const db = new Database(tmpPath, { readonly: true });
    const driver = betterSqliteDriver(db);

    const rows = driver.all('SELECT * FROM widgets WHERE name = ?', 'nonexistent');

    expect(rows).toHaveLength(0);

    db.close();
  });

  it('supports positional bind parameters', () => {
    const db = new Database(tmpPath, { readonly: true });
    const driver = betterSqliteDriver(db);

    const rows = driver.all('SELECT name FROM widgets WHERE qty > ?', 150);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'nut' });

    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// betterSqliteDriver — pragma()
// ─────────────────────────────────────────────────────────────────────────────

describe('betterSqliteDriver — pragma()', () => {
  it('returns rows for a pragma that produces table output', () => {
    const db = new Database(tmpPath, { readonly: true });
    const driver = betterSqliteDriver(db);

    const rows = driver.pragma('table_info(widgets)');

    expect(rows.length).toBeGreaterThan(0);
    // The pragma table_info returns rows with name, type, notnull, dflt_value, pk
    const names = rows.map((r) => r['name']);
    expect(names).toContain('id');
    expect(names).toContain('name');
    expect(names).toContain('qty');

    db.close();
  });

  it('returns a single-row array for schema_version', () => {
    const db = new Database(tmpPath, { readonly: true });
    const driver = betterSqliteDriver(db);

    const rows = driver.pragma('schema_version');

    expect(rows).toHaveLength(1);
    expect(typeof rows[0]!['schema_version']).toBe('number');

    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// betterSqliteDriver — close()
// ─────────────────────────────────────────────────────────────────────────────

describe('betterSqliteDriver — close()', () => {
  it('closes the underlying database without throwing', () => {
    const db = new Database(tmpPath, { readonly: true });
    const driver = betterSqliteDriver(db);

    expect(() => driver.close()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isNodeSqliteAvailable — Node version detection
// ─────────────────────────────────────────────────────────────────────────────

describe('isNodeSqliteAvailable()', () => {
  it('returns a boolean', () => {
    const result = isNodeSqliteAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('returns true on Node >= 22.5 and false on older versions', () => {
    // We do not know the exact runtime version in CI, but we can assert consistency:
    // the function's result MUST match whether process.versions.node >= 22.5.
    const [major, minor] = process.versions.node.split('.').map(Number);
    const expected = (major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 5);
    expect(isNodeSqliteAvailable()).toBe(expected);
  });
});
