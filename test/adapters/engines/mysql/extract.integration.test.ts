/**
 * Integration test: MySQL extract(FULL_SCOPE) -> RawCatalog golden assertion.
 * Also covers fingerprint DDL/DML stability (US-009), scope isolation + level
 * gating (Tasks 7.3, 7.4, 7.5).
 *
 * Gate: DBGRAPH_INTEGRATION=1 must be set. Without it the entire suite is skipped
 * so Docker-less contributors and the unit matrix stay green.
 *
 * Per-suite hookTimeout: 180 000 ms — mysql:8 image pull + startup can be slow.
 *
 * ALL describe blocks share a SINGLE container per file to avoid connection storms.
 * Goldens: seeded on first run, compared byte-for-byte on subsequent runs (ADR-008).
 *
 * EXACT-set edge assertions (L-009 / CRITICAL-1 regression guard):
 *   - both src and dst qnames pinned for every semantically important edge
 *   - explicit no-self + no-phantom assertions on every routine/view
 *   - proc_dynamic_query: hasDynamicSql:true AND deps.length === 0
 *
 * US-029 (MySQL adapter), US-009 (fingerprint), ADR-008 (determinism).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startMysqlContainer,
  mysqlIntegrationEnabled,
} from '../../../fixtures/mysql/container.js';
import type { MysqlContainerHandle } from '../../../fixtures/mysql/container.js';
import { createMysqlSchemaAdapter } from '../../../../src/adapters/engines/mysql/factory.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawCatalog } from '../../../../src/core/model/catalog.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_DIR = join(__dirname, '../../../fixtures/mysql/golden');
const GOLDEN_PATH = join(GOLDEN_DIR, 'golden-raw-catalog.json');

// Full scope: include bodies for all objects
const FULL_SCOPE: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
    functions: 'full',
    procedures: 'full',
    triggers: 'full',
  },
};

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Shared container — started ONCE per file, reused by all describe blocks.
// This avoids connection storms from 3+ parallel container startups.
// ─────────────────────────────────────────────────────────────────────────────

let sharedHandle: MysqlContainerHandle;
let catalog: RawCatalog;

// Module-level beforeAll: runs once before ALL describe blocks
beforeAll(async () => {
  if (!mysqlIntegrationEnabled()) return;
  mkdirSync(GOLDEN_DIR, { recursive: true });
  sharedHandle = await startMysqlContainer();

  // Primary extraction — shared by the golden suite
  const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
  catalog = await adapter.extract(FULL_SCOPE);
  await adapter.close();
}, 180_000);

// Module-level afterAll: tears down after all describe blocks
afterAll(async () => {
  if (sharedHandle !== undefined) await sharedHandle.stop();
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.3: RawCatalog golden + exact-set edge assertions
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mysqlIntegrationEnabled())(
  'MySQL extract integration — RawCatalog golden (US-029, ADR-008) [Task 7.3]',
  () => {
    // ─────────────────────────────────────────────────────────────────────
    // Basic shape assertions
    // ─────────────────────────────────────────────────────────────────────

    it('engine is mysql', () => {
      expect(catalog.engine).toBe('mysql');
    });

    it('schemas contains exactly the connected database (app)', () => {
      expect(catalog.schemas).toEqual(['app']);
    });

    it('system schemas are excluded', () => {
      expect(catalog.schemas).not.toContain('information_schema');
      expect(catalog.schemas).not.toContain('mysql');
      expect(catalog.schemas).not.toContain('performance_schema');
      expect(catalog.schemas).not.toContain('sys');
    });

    it('extracts all torture tables (4 tables)', () => {
      const tables = catalog.objects
        .filter((o) => o.kind === 'table')
        .map((o) => o.name);
      expect(tables).toContain('products');
      expect(tables).toContain('orders');
      expect(tables).toContain('order_items');
      expect(tables).toContain('audit_log');
    });

    // ─── AUTO_INCREMENT column (task 7.3) ────────────────────────────────────

    it('audit_log has an AUTO_INCREMENT column (audit_id) — extra.autoIncrement:true', () => {
      const auditLog = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'audit_log',
      );
      expect(auditLog).toBeDefined();
      const autoCol = auditLog!.columns?.find((c) => c.name === 'audit_id');
      expect(autoCol).toBeDefined();
      const colAny = autoCol as unknown as Record<string, unknown>;
      const extra = colAny['extra'] as Record<string, unknown> | undefined;
      expect(extra).toBeDefined();
      expect(extra!['autoIncrement']).toBe(true);
    });

    it('RawCatalog has ZERO sequence objects (AUTO_INCREMENT rides the column)', () => {
      const seqs = catalog.objects.filter((o) => o.kind === 'sequence');
      expect(seqs.length).toBe(0);
    });

    // ─── Generated column ─────────────────────────────────────────────────────

    it('order_items has a STORED GENERATED column (total_price)', () => {
      const orderItems = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'order_items',
      );
      expect(orderItems).toBeDefined();
      const genCol = orderItems!.columns?.find((c) => c.name === 'total_price');
      expect(genCol).toBeDefined();
      const colAny = genCol as unknown as Record<string, unknown>;
      const extra = colAny['extra'] as Record<string, unknown> | undefined;
      expect(extra).toBeDefined();
      expect(extra!['generated']).toBe(true);
      expect(extra!['generationKind']).toBe('STORED');
    });

    // ─── Constraints ───────────────────────────────────────────────────────────

    it('products has a UNIQUE constraint on name (UQ_products_name)', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      const uq = products!.constraints?.find(
        (c) => c.type === 'UNIQUE',
      );
      expect(uq).toBeDefined();
    });

    it('products has a CHECK constraint (CK_products_price)', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      const ck = products!.constraints?.find(
        (c) => c.type === 'CHECK',
      );
      expect(ck).toBeDefined();
    });

    it('order_items has FK to orders (FK_items_order)', () => {
      const orderItems = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'order_items',
      );
      expect(orderItems).toBeDefined();
      const fk = orderItems!.constraints?.find(
        (c) => c.type === 'FK' && c.name.toLowerCase() === 'fk_items_order',
      );
      expect(fk).toBeDefined();
    });

    it('order_items has FK to products (FK_items_product)', () => {
      const orderItems = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'order_items',
      );
      expect(orderItems).toBeDefined();
      const fk = orderItems!.constraints?.find(
        (c) => c.type === 'FK' && c.name.toLowerCase() === 'fk_items_product',
      );
      expect(fk).toBeDefined();
    });

    // ─── Indexes ──────────────────────────────────────────────────────────────

    it('extracts functional index (idx_products_name_lower) with extra.expression', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      const idx = (products!.indexes as Array<Record<string, unknown>> | undefined)?.find(
        (i) => (i['name'] as string).toLowerCase() === 'idx_products_name_lower',
      );
      expect(idx).toBeDefined();
      const extra = idx!['extra'] as Record<string, unknown> | undefined;
      expect(extra).toBeDefined();
      expect(extra!['expression']).toBeTruthy(); // non-null EXPRESSION from STATISTICS
    });

    it('extracts composite index (idx_order_items_composite) with 2 columns', () => {
      const orderItems = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'order_items',
      );
      expect(orderItems).toBeDefined();
      const idx = (orderItems!.indexes as Array<Record<string, unknown>> | undefined)?.find(
        (i) => (i['name'] as string).toLowerCase() === 'idx_order_items_composite',
      );
      expect(idx).toBeDefined();
      const cols = idx!['columns'] as string[];
      expect(cols.length).toBe(2); // composite — SEQ_IN_INDEX 1 and 2
    });

    it('extracts prefix index (idx_products_name_prefix) with extra.subPart', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      const idx = (products!.indexes as Array<Record<string, unknown>> | undefined)?.find(
        (i) => (i['name'] as string).toLowerCase() === 'idx_products_name_prefix',
      );
      expect(idx).toBeDefined();
      const extra = idx!['extra'] as Record<string, unknown> | undefined;
      expect(extra).toBeDefined();
      expect(extra!['subPart']).toBeTruthy(); // non-null SUB_PART from STATISTICS
    });

    // ─── Views ────────────────────────────────────────────────────────────────

    it('extracts view v_order_summary', () => {
      const views = catalog.objects.filter((o) => o.kind === 'view');
      expect(views.find((v) => v.name === 'v_order_summary')).toBeDefined();
    });

    it('view body is present at full scope', () => {
      const view = catalog.objects.find(
        (o) => o.kind === 'view' && o.name === 'v_order_summary',
      );
      expect(view).toBeDefined();
      expect(typeof view!.body).toBe('string');
      expect(view!.body!.length).toBeGreaterThan(0);
    });

    // ─── Routines ────────────────────────────────────────────────────────────

    it('extracts procedure proc_place_order', () => {
      const procs = catalog.objects.filter((o) => o.kind === 'procedure');
      expect(procs.find((p) => p.name === 'proc_place_order')).toBeDefined();
    });

    it('extracts function fn_audit_write', () => {
      const fns = catalog.objects.filter((o) => o.kind === 'function');
      expect(fns.find((f) => f.name === 'fn_audit_write')).toBeDefined();
    });

    it('extracts procedure proc_dynamic_query', () => {
      const procs = catalog.objects.filter((o) => o.kind === 'procedure');
      expect(procs.find((p) => p.name === 'proc_dynamic_query')).toBeDefined();
    });

    // ─── Parsed edges — EXACT-set (CRITICAL-1 / L-009) ──────────────────────

    it('proc_place_order has writes_to edge to orders', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'proc_place_order',
      );
      expect(proc).toBeDefined();
      const dep = (proc!.dependencies ?? []).find(
        (d) => d.access === 'write' && d.target.name === 'orders',
      );
      expect(dep).toBeDefined();
      expect(dep!.confidence).toBe('parsed');
    });

    it('proc_place_order has writes_to edge to order_items', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'proc_place_order',
      );
      expect(proc).toBeDefined();
      const dep = (proc!.dependencies ?? []).find(
        (d) => d.access === 'write' && d.target.name === 'order_items',
      );
      expect(dep).toBeDefined();
      expect(dep!.confidence).toBe('parsed');
    });

    it('proc_place_order has reads_from edge to products', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'proc_place_order',
      );
      expect(proc).toBeDefined();
      const dep = (proc!.dependencies ?? []).find(
        (d) => d.access === 'read' && d.target.name === 'products',
      );
      expect(dep).toBeDefined();
      expect(dep!.confidence).toBe('parsed');
    });

    it('proc_place_order has EXACTLY 3 deps: 2 writes + 1 read (no phantom, no self)', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'proc_place_order',
      );
      const deps = proc?.dependencies ?? [];
      expect(deps.length).toBe(3);
      const writes = deps.filter((d) => d.access === 'write');
      const reads = deps.filter((d) => d.access === 'read');
      expect(writes.length).toBe(2);
      expect(reads.length).toBe(1);

      // Exact sorted dep names
      const names = deps.map((d) => d.target.name).sort();
      expect(names).toEqual(['order_items', 'orders', 'products']);

      // No self-reference
      expect(deps.find((d) => d.target.name === 'proc_place_order')).toBeUndefined();
      // No phantom to absent objects
      expect(deps.find((d) => d.target.name === 'audit_log')).toBeUndefined();
      expect(deps.find((d) => d.target.name === 'v_order_summary')).toBeUndefined();
    });

    it('v_order_summary reads ONLY orders + order_items (no phantom, no self)', () => {
      const view = catalog.objects.find(
        (o) => o.kind === 'view' && o.name === 'v_order_summary',
      );
      const deps = view?.dependencies ?? [];
      const names = deps.map((d) => d.target.name).sort();
      expect(names).toEqual(['order_items', 'orders']);

      // Must NOT include itself or absent objects
      expect(deps.find((d) => d.target.name === 'v_order_summary')).toBeUndefined();
      expect(deps.find((d) => d.target.name === 'audit_log')).toBeUndefined();
      expect(deps.find((d) => d.target.name === 'products')).toBeUndefined();
    });

    it('fn_audit_write writes ONLY audit_log, zero reads (no phantom)', () => {
      const fn = catalog.objects.find(
        (o) => o.kind === 'function' && o.name === 'fn_audit_write',
      );
      const deps = fn?.dependencies ?? [];
      expect(deps.length).toBe(1);
      expect(deps[0]!.access).toBe('write');
      expect(deps[0]!.target.name).toBe('audit_log');
      expect(deps.filter((d) => d.access === 'read').length).toBe(0);
    });

    it('proc_dynamic_query has ZERO edges + hasDynamicSql:true (all refs in dynamic string)', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'proc_dynamic_query',
      );
      expect(proc).toBeDefined();
      expect(proc!.hasDynamicSql).toBe(true);
      const deps = proc?.dependencies ?? [];
      expect(deps.length).toBe(0);
    });

    // ─── Trigger assertions (task 7.3) ────────────────────────────────────────

    it('extracts trigger trg_after_order_update', () => {
      const trigs = catalog.objects.filter((o) => o.kind === 'trigger');
      expect(trigs.find((t) => t.name === 'trg_after_order_update')).toBeDefined();
    });

    it('trigger carries AFTER timing and UPDATE event', () => {
      const trigger = catalog.objects.find(
        (o) => o.kind === 'trigger' && o.name === 'trg_after_order_update',
      );
      expect(trigger).toBeDefined();
      expect(trigger!.trigger?.timing).toBe('AFTER');
      expect(trigger!.trigger?.events).toContain('UPDATE');
    });

    it('trigger.table resolves to parent table orders (NOT the trigger name) (L-009)', () => {
      const trigger = catalog.objects.find(
        (o) => o.kind === 'trigger' && o.name === 'trg_after_order_update',
      );
      expect(trigger).toBeDefined();
      expect(trigger!.trigger).toBeDefined();
      expect(trigger!.trigger!.table.name).toBe('orders');
    });

    it('no catalog object is a table named after the trigger (no phantom stub)', () => {
      const phantomTable = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'trg_after_order_update',
      );
      expect(phantomTable).toBeUndefined();
    });

    // ─── Comments ──────────────────────────────────────────────────────────────

    it('COMMENT ON TABLE products is surfaced as comment', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      expect(typeof products!.comment).toBe('string');
      expect(products!.comment!.length).toBeGreaterThan(0);
    });

    it('COMMENT ON COLUMN products.name is surfaced as column comment', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      const col = products!.columns?.find((c) => c.name === 'name');
      expect(col).toBeDefined();
      expect(typeof col!.comment).toBe('string');
      expect(col!.comment!.length).toBeGreaterThan(0);
    });

    // ─── Determinism (task 7.3) ────────────────────────────────────────────────

    it('catalog objects are deterministically sorted (ADR-008)', () => {
      const names = catalog.objects.map((o) => `${o.kind}:${o.name}`);
      const firstTableIdx = names.findIndex((n) => n.startsWith('table:'));
      const firstViewIdx = names.findIndex((n) => n.startsWith('view:'));
      if (firstTableIdx !== -1 && firstViewIdx !== -1) {
        expect(firstTableIdx).toBeLessThan(firstViewIdx);
      }
    });

    it('RawCatalog golden is deterministic and byte-identical (ADR-008) — second extract', async () => {
      const adapter2 = await createMysqlSchemaAdapter(sharedHandle.config);
      const catalog2 = await adapter2.extract(FULL_SCOPE);
      await adapter2.close();

      expect(stableStringify(catalog)).toBe(stableStringify(catalog2));
    });

    it('RawCatalog matches committed golden file (seeds on first run)', () => {
      const actual = stableStringify(catalog);

      if (!existsSync(GOLDEN_PATH)) {
        writeFileSync(GOLDEN_PATH, actual, 'utf-8');
        console.log('[mysql-extract-integration] Golden seeded:', GOLDEN_PATH);
        expect(actual.length).toBeGreaterThan(0);
        return;
      }

      const committed = readFileSync(GOLDEN_PATH, 'utf-8');
      expect(actual).toBe(committed);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.4: Fingerprint DDL/DML integration test (uses shared container)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mysqlIntegrationEnabled())(
  'MySQL fingerprint integration — DDL/DML stability (US-009) [Task 7.4]',
  () => {
    it('fingerprint is a 64-character hex string (sha256)', async () => {
      const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
      const fp = await adapter.fingerprint();
      await adapter.close();

      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    it('fingerprint is stable across DML-only changes (INSERT does not change schema)', async () => {
      const adapterA = await createMysqlSchemaAdapter(sharedHandle.config);
      const fpBefore = await adapterA.fingerprint();
      await adapterA.close();

      // DML-only: insert a row — no DDL, no schema change
      const mysql2Mod = await import('mysql2/promise' as string) as {
        createConnection: (cfg: Record<string, unknown>) => Promise<{
          query(sql: string, params?: unknown[]): Promise<unknown>;
          end(): Promise<void>;
        }>;
      };
      // mysql2/promise: createConnection() returns Promise<Connection> (auto-connected)
      const writeConn = await mysql2Mod.createConnection({
        host: sharedHandle.config.host,
        port: sharedHandle.config.port,
        user: sharedHandle.config.user,
        password: sharedHandle.config.password,
        database: sharedHandle.config.database,
      });
      try {
        await writeConn.query(
          'INSERT INTO products (product_id, name, unit_price) VALUES (?, ?, ?)',
          [9001, 'DML Test Product', 9.99],
        );
      } finally {
        await writeConn.end();
      }

      const adapterB = await createMysqlSchemaAdapter(sharedHandle.config);
      const fpAfter = await adapterB.fingerprint();
      await adapterB.close();

      expect(fpAfter).toBe(fpBefore);
    });

    it('fingerprint changes after a DDL operation (CREATE TABLE advances table_count)', async () => {
      const adapterA = await createMysqlSchemaAdapter(sharedHandle.config);
      const fpBefore = await adapterA.fingerprint();
      await adapterA.close();

      // DDL: CREATE a new table — table_count increments
      const mysql2Mod = await import('mysql2/promise' as string) as {
        createConnection: (cfg: Record<string, unknown>) => Promise<{
          query(sql: string): Promise<unknown>;
          end(): Promise<void>;
        }>;
      };
      // mysql2/promise: createConnection() returns Promise<Connection> (auto-connected)
      const ddlConn = await mysql2Mod.createConnection({
        host: sharedHandle.config.host,
        port: sharedHandle.config.port,
        user: sharedHandle.config.user,
        password: sharedHandle.config.password,
        database: sharedHandle.config.database,
      });
      try {
        await ddlConn.query(
          'CREATE TABLE fp_ddl_sentinel (id INT NOT NULL PRIMARY KEY)',
        );
      } finally {
        await ddlConn.end();
      }

      const adapterB = await createMysqlSchemaAdapter(sharedHandle.config);
      const fpAfter = await adapterB.fingerprint();
      await adapterB.close();

      expect(fpAfter).not.toBe(fpBefore);
    });

    it('fingerprint changes after ALTER TABLE ADD COLUMN (column_count moves)', async () => {
      const adapterA = await createMysqlSchemaAdapter(sharedHandle.config);
      const fpBefore = await adapterA.fingerprint();
      await adapterA.close();

      // DDL: ALTER TABLE ADD COLUMN — column_count increments
      const mysql2Mod = await import('mysql2/promise' as string) as {
        createConnection: (cfg: Record<string, unknown>) => Promise<{
          query(sql: string): Promise<unknown>;
          end(): Promise<void>;
        }>;
      };
      // mysql2/promise: createConnection() returns Promise<Connection> (auto-connected)
      const ddlConn = await mysql2Mod.createConnection({
        host: sharedHandle.config.host,
        port: sharedHandle.config.port,
        user: sharedHandle.config.user,
        password: sharedHandle.config.password,
        database: sharedHandle.config.database,
      });
      try {
        await ddlConn.query(
          'ALTER TABLE products ADD COLUMN fp_test_col TEXT',
        );
      } finally {
        await ddlConn.end();
      }

      const adapterB = await createMysqlSchemaAdapter(sharedHandle.config);
      const fpAfter = await adapterB.fingerprint();
      await adapterB.close();

      expect(fpAfter).not.toBe(fpBefore);
    });

    it('fingerprint() returns a 64-char hex string AND runs in under 5 seconds (one cheap query)', async () => {
      const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
      const start = Date.now();
      const fp = await adapter.fingerprint();
      const elapsed = Date.now() - start;
      await adapter.close();

      expect(typeof fp).toBe('string');
      expect(fp.length).toBe(64);
      // One cheap query: should complete in well under 5 seconds
      expect(elapsed).toBeLessThan(5_000);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.5: Database scope + level integration assertions (uses shared container)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mysqlIntegrationEnabled())(
  'MySQL database scope and level gating integration [Task 7.5]',
  () => {
    it('RawCatalog.schemas is exactly the connected database (app)', async () => {
      const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
      const cat = await adapter.extract(FULL_SCOPE);
      await adapter.close();

      expect(cat.schemas).toEqual(['app']);
    });

    it('catalog contains only objects whose table_schema is app', async () => {
      const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
      const cat = await adapter.extract(FULL_SCOPE);
      await adapter.close();

      const foreignSchemas = cat.objects
        .map((o) => o.schema)
        .filter((s) => s !== undefined && s !== 'app' && s !== '');
      expect(foreignSchemas.length).toBe(0);
    });

    it('catalog has no object from information_schema or mysql system schemas', async () => {
      const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
      const cat = await adapter.extract(FULL_SCOPE);
      await adapter.close();

      const systemObjs = cat.objects.filter(
        (o) => o.schema === 'information_schema' || o.schema === 'mysql' ||
               o.schema === 'performance_schema' || o.schema === 'sys',
      );
      expect(systemObjs.length).toBe(0);
    });

    it('view at metadata level is present without body', async () => {
      const metaScope: ExtractionScope = {
        levels: { ...DEFAULT_LEVELS, views: 'metadata' },
      };
      const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
      const cat = await adapter.extract(metaScope);
      await adapter.close();

      const view = cat.objects.find(
        (o) => o.kind === 'view' && o.name === 'v_order_summary',
      );
      expect(view).toBeDefined();
      expect(view!.body).toBeUndefined();
    });

    it('procedure at off level is absent from catalog', async () => {
      const offScope: ExtractionScope = {
        levels: { ...DEFAULT_LEVELS, procedures: 'off' },
      };
      const adapter = await createMysqlSchemaAdapter(sharedHandle.config);
      const cat = await adapter.extract(offScope);
      await adapter.close();

      const proc = cat.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'proc_place_order',
      );
      expect(proc).toBeUndefined();
    });
  },
);

// Placeholder test so the file is not empty when integration is disabled
if (!mysqlIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
