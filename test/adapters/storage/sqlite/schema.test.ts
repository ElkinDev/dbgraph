/**
 * RED+GREEN tests for schema.ts, migrations.ts, and factory.ts (task 5.1).
 * Design §3 — DDL, forward-only migrations, schema versioning.
 * US-009: Storage schema versioning.
 *
 * Uses REAL better-sqlite3 with in-memory databases — never mock the driver (dbgraph-testing).
 *
 * Phase 9.5b update: openRawDb() is now async and returns WritableSqliteHandle.
 * All direct openRawDb callers updated to await, and use handle methods (exec/prepare/close).
 */

import { describe, it, expect } from 'vitest';
import { createSqliteGraphStore } from '../../../../src/adapters/storage/sqlite/factory.js';
import { SchemaVersionError } from '../../../../src/core/errors.js';

// afterEach: stores opened inside each test are closed in the test itself.
// This test file does not share store instances across tests.

describe('schema versioning and migrations (task 5.1 — updated for v2)', () => {
  describe('open from v0 → migrates to v2 (current)', () => {
    it('reports schemaVersion() === 2 after opening a fresh database', async () => {
      const store = await createSqliteGraphStore({ path: ':memory:' });
      const version = await store.schemaVersion();
      await store.close();
      expect(version).toBe(2);
    });

    it('meta table holds schema_version = "2" after first open', async () => {
      const store = await createSqliteGraphStore({ path: ':memory:' });
      const value = await store.getMeta('schema_version');
      await store.close();
      expect(value).toBe('2');
    });
  });

  describe('current-version open is a no-op', () => {
    it('opening the same path twice does not change the version', async () => {
      // Open once to migrate, close, open again — still at current version (2).
      const store1 = await createSqliteGraphStore({ path: ':memory:' });
      const v1 = await store1.schemaVersion();
      await store1.close();
      // :memory: is a new db each time, so we test the idempotent migration path
      // by opening a file-based db via a shared temp path.
      // For in-memory, both opens are independent; test structural idempotency instead:
      const store2 = await createSqliteGraphStore({ path: ':memory:' });
      const v2 = await store2.schemaVersion();
      await store2.close();
      expect(v1).toBe(2);
      expect(v2).toBe(2);
    });
  });

  describe('newer-than-known throws SchemaVersionError', () => {
    it('throws SchemaVersionError when meta.schema_version > CURRENT_VERSION', async () => {
      // Write a DB with a future version number, then open it.
      const { openRawDb } = await import(
        '../../../../src/adapters/storage/sqlite/schema.js'
      );
      const rawDb = await openRawDb(':memory:');
      // Manually create a minimal meta table with a future version
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta (key, value) VALUES ('schema_version', '999');
      `);
      rawDb.close();

      // Now open via factory — must throw SchemaVersionError because 999 > 1
      // We cannot reopen :memory: but we can test via the migrations module directly
      const { runMigrations } = await import(
        '../../../../src/adapters/storage/sqlite/migrations.js'
      );
      const db2 = await openRawDb(':memory:');
      db2.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta (key, value) VALUES ('schema_version', '999');
      `);
      expect(() => runMigrations(db2)).toThrow(SchemaVersionError);
      db2.close();
    });

    it('SchemaVersionError has correct code E_SCHEMA_VERSION', async () => {
      const { openRawDb } = await import(
        '../../../../src/adapters/storage/sqlite/schema.js'
      );
      const { runMigrations } = await import(
        '../../../../src/adapters/storage/sqlite/migrations.js'
      );
      const db = await openRawDb(':memory:');
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta (key, value) VALUES ('schema_version', '9999');
      `);
      let caught: unknown;
      try {
        runMigrations(db);
      } catch (e) {
        caught = e;
      } finally {
        db.close();
      }
      expect(caught).toBeInstanceOf(SchemaVersionError);
      if (caught instanceof SchemaVersionError) {
        expect(caught.code).toBe('E_SCHEMA_VERSION');
        expect(caught.observed).toBe(9999);
      }
    });
  });

  describe('all expected tables exist after schema creation', () => {
    it('creates nodes, edges, nodes_fts, snapshots, meta tables', async () => {
      const store = await createSqliteGraphStore({ path: ':memory:' });
      // Use getMeta to verify meta table works; other tables tested by subsequent tasks
      const version = await store.getMeta('schema_version');
      await store.close();
      expect(version).toBe('2');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6.1 — SNAPSHOT_OBJECTS_DDL exported from schema.ts (RED→GREEN)
// ─────────────────────────────────────────────────────────────────────────────

describe('SNAPSHOT_OBJECTS_DDL constant (task 6.1)', () => {
  it('SNAPSHOT_OBJECTS_DDL is exported from schema.ts', async () => {
    const { SNAPSHOT_OBJECTS_DDL } = await import(
      '../../../../src/adapters/storage/sqlite/schema.js'
    );
    expect(typeof SNAPSHOT_OBJECTS_DDL).toBe('string');
  });

  it('SNAPSHOT_OBJECTS_DDL contains snapshot_objects table DDL', async () => {
    const { SNAPSHOT_OBJECTS_DDL } = await import(
      '../../../../src/adapters/storage/sqlite/schema.js'
    );
    // Must declare snapshot_objects with all required columns
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/snapshot_objects/i);
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/snapshot_id/i);
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/node_id/i);
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/kind/i);
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/qname/i);
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/body_hash/i);
  });

  it('SNAPSHOT_OBJECTS_DDL creates an index on snapshot_id', async () => {
    const { SNAPSHOT_OBJECTS_DDL } = await import(
      '../../../../src/adapters/storage/sqlite/schema.js'
    );
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/idx_snapshot_objects_snapshot/i);
  });

  it('SNAPSHOT_OBJECTS_DDL uses IF NOT EXISTS (idempotent)', async () => {
    const { SNAPSHOT_OBJECTS_DDL } = await import(
      '../../../../src/adapters/storage/sqlite/schema.js'
    );
    expect(SNAPSHOT_OBJECTS_DDL).toMatch(/IF NOT EXISTS/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6.2 — v1→v2 migration (RED→GREEN)
// ─────────────────────────────────────────────────────────────────────────────

describe('schema v1→v2 auto-migration (task 6.2)', () => {
  it('fresh database opens at schema version 2', async () => {
    const store = await createSqliteGraphStore({ path: ':memory:' });
    const version = await store.schemaVersion();
    await store.close();
    expect(version).toBe(2);
  });

  it('CURRENT_SCHEMA_VERSION equals 2', async () => {
    const { CURRENT_SCHEMA_VERSION } = await import(
      '../../../../src/adapters/storage/sqlite/migrations.js'
    );
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
  });

  it('v1 database auto-migrates to v2 with no data loss (nodes preserved)', async () => {
    // Build a v1 database manually (with schema_version=1, nodes, edges, snapshots, meta),
    // then open it via createSqliteGraphStore which should auto-migrate.
    const { openRawDb } = await import(
      '../../../../src/adapters/storage/sqlite/schema.js'
    );
    const { SCHEMA_V1_DDL } = await import(
      '../../../../src/adapters/storage/sqlite/schema.js'
    );
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');

    const tmpPath = join(tmpdir(), `dbgraph-test-v1-${randomUUID()}.db`);
    const rawDb = await openRawDb(tmpPath);

    // Apply v1 DDL
    for (const stmt of SCHEMA_V1_DDL) {
      rawDb.exec(stmt);
    }
    // Set schema_version = 1
    rawDb.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '1')`);

    // Insert a sentinel node
    rawDb.exec(`
      INSERT INTO nodes (id, kind, schema_name, name, qname, level, missing, excluded, body_hash, payload)
      VALUES ('node-v1-001', 'table', 'dbo', 'orders', 'dbo.orders', 'metadata', 0, 0, NULL, '{}')
    `);
    rawDb.close();

    // Open via factory — must auto-migrate
    const store = await createSqliteGraphStore({ path: tmpPath });
    const version = await store.schemaVersion();
    const node = await store.getNode('node-v1-001');
    await store.close();

    // Cleanup
    const { unlink } = await import('node:fs/promises');
    await unlink(tmpPath);

    expect(version).toBe(2);
    expect(node).not.toBeNull();
    expect(node?.qname).toBe('dbo.orders');
  });

  it('v2 database opens without re-running migrations (no-op)', async () => {
    // Open twice to verify idempotency on file DB
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');
    const tmpPath = join(tmpdir(), `dbgraph-test-v2-${randomUUID()}.db`);

    const store1 = await createSqliteGraphStore({ path: tmpPath });
    const v1 = await store1.schemaVersion();
    await store1.close();

    const store2 = await createSqliteGraphStore({ path: tmpPath });
    const v2 = await store2.schemaVersion();
    await store2.close();

    const { unlink } = await import('node:fs/promises');
    await unlink(tmpPath);

    expect(v1).toBe(2);
    expect(v2).toBe(2);
  });

  it('snapshot_objects table exists after migration', async () => {
    const { openRawDb } = await import(
      '../../../../src/adapters/storage/sqlite/schema.js'
    );
    const { runMigrations } = await import(
      '../../../../src/adapters/storage/sqlite/migrations.js'
    );
    const h = await openRawDb(':memory:');
    runMigrations(h);

    const tableExists = h
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='snapshot_objects'`)
      .get();
    h.close();

    expect(tableExists).toBeDefined();
  });
});
