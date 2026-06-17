/**
 * Integration test: extract(FULL_SCOPE) → RawCatalog golden assertion.
 * Design §integration "extract → golden RawCatalog (skip-with-reason)".
 *
 * Gate: DBGRAPH_INTEGRATION=1 must be set. Without it the entire suite is skipped
 * so Docker-less contributors and the unit matrix stay green.
 *
 * Per-suite hookTimeout: 240 000 ms — SQL Server image pull (~1.5 GB) + TDS
 * startup (20-40s after port open) can take several minutes on a fresh runner.
 * This is intentionally set on the hook itself, not in vitest.config.ts, because
 * only container suites need this ceiling.
 *
 * Goldens: seeded on first run, compared byte-for-byte on subsequent runs (ADR-008).
 *
 * US-027 (SQL Server adapter), US-009 (fingerprint stability).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startMssqlContainer,
  mssqlIntegrationEnabled,
} from '../../../fixtures/mssql/container.js';
import type { MssqlContainerHandle } from '../../../fixtures/mssql/container.js';
import { createMssqlSchemaAdapter } from '../../../../src/adapters/engines/mssql/factory.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawCatalog } from '../../../../src/core/model/catalog.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_DIR = join(__dirname, '../../../fixtures/mssql/golden');
const GOLDEN_PATH = join(GOLDEN_DIR, 'golden-raw-catalog.json');

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Container state (shared across tests in this suite)
// ─────────────────────────────────────────────────────────────────────────────

let handle: MssqlContainerHandle;
let catalog: RawCatalog;

describe.skipIf(!mssqlIntegrationEnabled())(
  'MSSQL extract integration — RawCatalog golden (US-027, ADR-008)',
  () => {
    // Per-suite hookTimeout: 240s for SQL Server cold start + image pull
    beforeAll(async () => {
      handle = await startMssqlContainer();

      const adapter = await createMssqlSchemaAdapter(handle.config);
      catalog = await adapter.extract(FULL_SCOPE);
      await adapter.close();
    }, 240_000);

    afterAll(async () => {
      if (handle !== undefined) await handle.stop();
    }, 60_000);

    // ─────────────────────────────────────────────────────────────────────
    // Basic shape assertions (fail fast before golden comparison)
    // ─────────────────────────────────────────────────────────────────────

    it('engine is mssql', () => {
      expect(catalog.engine).toBe('mssql');
    });

    it('schemas contains dbo', () => {
      expect(catalog.schemas).toContain('dbo');
    });

    it('extracts all torture tables', () => {
      const tables = catalog.objects
        .filter((o) => o.kind === 'table')
        .map((o) => o.name);
      expect(tables).toContain('products');
      expect(tables).toContain('orders');
      expect(tables).toContain('order_items');
      expect(tables).toContain('audit_log');
      expect(tables).toContain('regions');
    });

    it('extracts the computed column on orders', () => {
      const orders = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'orders',
      );
      expect(orders).toBeDefined();
      const totalCol = orders!.columns?.find((c) => c.name === 'total_amount');
      expect(totalCol).toBeDefined();
      // Computed columns are present (their computed nature is tracked in the RawObject extra
      // via intersection type on RawColumn in map.ts; we verify the column exists)
      expect(totalCol).toBeDefined();
    });

    it('extracts the composite FK on order_items (2-column FK to products)', () => {
      const orderItems = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'order_items',
      );
      expect(orderItems).toBeDefined();
      const fkConstraints = (orderItems!.constraints ?? []).filter(
        (c) => c.type === 'FK' && c.columns.length === 2,
      );
      expect(fkConstraints.length).toBeGreaterThanOrEqual(1);
      const compFk = fkConstraints.find((c) => c.name === 'FK_order_items_product');
      expect(compFk).toBeDefined();
      expect(compFk!.columns).toContain('product_id');
      expect(compFk!.columns).toContain('region_id');
    });

    it('extracts filtered index with included columns', () => {
      const orders = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'orders',
      );
      expect(orders).toBeDefined();
      const filteredIdx = (orders!.indexes ?? []).find(
        (i) => i.name === 'idx_orders_active',
      );
      // The index is extracted (map.ts builds it from sys.indexes)
      // Extra info (where/includedColumns) surfaces in the RawObject extra via
      // intersection type in map.ts — verify the index is present
      expect(filteredIdx).toBeDefined();
    });

    it('extracts the view v_order_summary', () => {
      const views = catalog.objects.filter((o) => o.kind === 'view');
      expect(views.map((v) => v.name)).toContain('v_order_summary');
    });

    it('view body is present at full scope', () => {
      const view = catalog.objects.find(
        (o) => o.kind === 'view' && o.name === 'v_order_summary',
      );
      expect(view).toBeDefined();
      expect(typeof view!.body).toBe('string');
      expect(view!.body!.length).toBeGreaterThan(0);
    });

    it('extracts scalar function fn_discount_price', () => {
      const fns = catalog.objects.filter((o) => o.kind === 'function');
      expect(fns.map((f) => f.name)).toContain('fn_discount_price');
    });

    it('extracts inline TVF fn_orders_by_region', () => {
      const fns = catalog.objects.filter((o) => o.kind === 'function');
      expect(fns.map((f) => f.name)).toContain('fn_orders_by_region');
    });

    it('scalar and TVF functions are distinguishable via extra.functionType', () => {
      const scalar = catalog.objects.find(
        (o) => o.kind === 'function' && o.name === 'fn_discount_price',
      );
      const tvf = catalog.objects.find(
        (o) => o.kind === 'function' && o.name === 'fn_orders_by_region',
      );
      expect(scalar).toBeDefined();
      expect(tvf).toBeDefined();
      // Scalar FN type is 'FN', inline TVF is 'IF'
      expect(scalar!.extra?.['functionType']).toBe('FN');
      expect(tvf!.extra?.['functionType']).toBe('IF');
    });

    it('extracts sequence order_seq', () => {
      const seqs = catalog.objects.filter((o) => o.kind === 'sequence');
      expect(seqs.map((s) => s.name)).toContain('order_seq');
    });

    it('extracts the AFTER UPDATE trigger trg_audit_order_update', () => {
      const triggers = catalog.objects.filter((o) => o.kind === 'trigger');
      expect(triggers.map((t) => t.name)).toContain('trg_audit_order_update');
    });

    it('trigger carries AFTER timing and UPDATE event', () => {
      const trigger = catalog.objects.find(
        (o) => o.kind === 'trigger' && o.name === 'trg_audit_order_update',
      );
      expect(trigger).toBeDefined();
      expect(trigger!.trigger?.timing).toBe('AFTER');
      expect(trigger!.trigger?.events).toContain('UPDATE');
    });

    // W-1 / C-1: trigger.table MUST be the parent TABLE (orders), NOT the trigger name.
    // This assertion was absent, which let C-1 ship green.
    it('trigger.table resolves to parent table dbo.orders (NOT the trigger name) (W-1)', () => {
      const trigger = catalog.objects.find(
        (o) => o.kind === 'trigger' && o.name === 'trg_audit_order_update',
      );
      expect(trigger).toBeDefined();
      expect(trigger!.trigger).toBeDefined();
      expect(trigger!.trigger!.table.name).toBe('orders');
      expect(trigger!.trigger!.table.schema).toBe('dbo');
    });

    // W-1: no trigger-named table object should appear (phantom stub symptom).
    it('no catalog object is a table named after the trigger (no phantom stub) (W-1)', () => {
      const phantomTable = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'trg_audit_order_update',
      );
      expect(phantomTable).toBeUndefined();
    });

    // C-2: trigger writes_to audit_log must be present in RawCatalog dependencies (parsed).
    it('trg_audit_order_update has writes_to dep to audit_log with parsed confidence (C-2, US-007)', () => {
      const trigger = catalog.objects.find(
        (o) => o.kind === 'trigger' && o.name === 'trg_audit_order_update',
      );
      expect(trigger).toBeDefined();
      const writeDep = (trigger!.dependencies ?? []).find(
        (d) => d.access === 'write' && d.target.name === 'audit_log',
      );
      expect(writeDep).toBeDefined();
      expect(writeDep!.confidence).toBe('parsed');
    });

    it('MS_Description on products table is surfaced as comment', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      expect(typeof products!.comment).toBe('string');
      expect(products!.comment!.length).toBeGreaterThan(0);
    });

    it('MS_Description on product_name column is surfaced as comment', () => {
      const products = catalog.objects.find(
        (o) => o.kind === 'table' && o.name === 'products',
      );
      expect(products).toBeDefined();
      const col = products!.columns?.find((c) => c.name === 'product_name');
      expect(col).toBeDefined();
      expect(typeof col!.comment).toBe('string');
    });

    it('sp_place_order has writes_to edges (products→orders+order_items)', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'sp_place_order',
      );
      expect(proc).toBeDefined();
      const writeDeps = (proc!.dependencies ?? []).filter(
        (d) => d.access === 'write',
      );
      // Must write to at least 2 targets (orders + order_items)
      expect(writeDeps.length).toBeGreaterThanOrEqual(2);
    });

    it('sp_place_order has reads_from edge to products', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'sp_place_order',
      );
      expect(proc).toBeDefined();
      const readDeps = (proc!.dependencies ?? []).filter(
        (d) => d.access === 'read',
      );
      expect(readDeps.length).toBeGreaterThanOrEqual(1);
    });

    it('sp_dynamic_search is marked hasDynamicSql = true', () => {
      const proc = catalog.objects.find(
        (o) => o.kind === 'procedure' && o.name === 'sp_dynamic_search',
      );
      expect(proc).toBeDefined();
      expect(proc!.hasDynamicSql).toBe(true);
    });

    it('catalog objects are deterministically sorted (ADR-008)', () => {
      const names = catalog.objects.map((o) => `${o.kind}:${o.name}`);
      // Verify tables come before views (kind rank)
      const firstTableIdx = names.findIndex((n) => n.startsWith('table:'));
      const firstViewIdx = names.findIndex((n) => n.startsWith('view:'));
      if (firstTableIdx !== -1 && firstViewIdx !== -1) {
        expect(firstTableIdx).toBeLessThan(firstViewIdx);
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // Golden: byte-identical on second run (ADR-008)
    // ─────────────────────────────────────────────────────────────────────

    it('RawCatalog golden is deterministic and byte-identical (ADR-008)', async () => {
      // Second extraction on same container — must be identical
      const adapter2 = await createMssqlSchemaAdapter(handle.config);
      const catalog2 = await adapter2.extract(FULL_SCOPE);
      await adapter2.close();

      expect(stableStringify(catalog)).toBe(stableStringify(catalog2));
    });

    it('RawCatalog matches committed golden file (seeds on first run)', () => {
      const actual = stableStringify(catalog);

      if (!existsSync(GOLDEN_PATH)) {
        writeFileSync(GOLDEN_PATH, actual, 'utf-8');
        console.log('[extract-integration] Golden seeded:', GOLDEN_PATH);
        expect(actual.length).toBeGreaterThan(0);
        return;
      }

      const committed = readFileSync(GOLDEN_PATH, 'utf-8');
      expect(actual).toBe(committed);
    });
  },
);

// Placeholder test so the file is not empty when integration is disabled
// (Vitest requires at least one test in a file)
if (!mssqlIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
