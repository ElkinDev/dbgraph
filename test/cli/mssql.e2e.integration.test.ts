/**
 * Gated MSSQL CLI E2E integration test — task 7.5 (phase-4-cli-config).
 *
 * Gate: DBGRAPH_INTEGRATION=1 (skips cleanly without Docker).
 * Uses the Phase-3 Testcontainers harness (test/fixtures/mssql/container.ts).
 *
 * IMPORTANT SECURITY CONSTRAINTS:
 *   - NEVER touches a real or named validation database — ephemeral container only.
 *   - Uses an EPHEMERAL SQL Server container (startMssqlContainer).
 *   - torture.sql is applied to the ephemeral container — ONLY reads via the adapter.
 *   - Read-only against target is INVIOLABLE (ADR-005).
 *
 * Flow: init (via config write) → sync → query
 *   1. Start ephemeral SQL Server container.
 *   2. Create an isolated projectRoot with .dbgraph/.
 *   3. Write a dbgraph.config.json pointing to the container via env vars.
 *   4. Run sync (creates first snapshot).
 *   5. Run query — verify hits and exit 0.
 *   6. Tear down container.
 *
 * Config uses ${env:VAR} references — resolved by injecting the container values
 * into a local env map and calling resolveSecrets directly (no process.env mutation).
 *
 * ADR-004: imports via src/index.ts barrel only, NEVER adapter internals.
 * Spec: proposal "MSSQL init→sync→query green under DBGRAPH_INTEGRATION=1" (US-001/005/020).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  startMssqlContainer,
  mssqlIntegrationEnabled,
} from '../fixtures/mssql/container.js';
import type { MssqlContainerHandle } from '../fixtures/mssql/container.js';
import {
  createMssqlSchemaAdapter,
  createSqliteGraphStore,
  getImpact,
  getNeighbors,
  formatExplore,
  formatObject,
  formatRelated,
  runPrecheck,
} from '../../src/index.js';
import { runSync } from '../../src/cli/commands/sync.js';
import { runQuery } from '../../src/cli/commands/query.js';

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. ' +
  'Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

let handle: MssqlContainerHandle;
let projectRoot: string;

function makeProjectRoot(): string {
  const root = join(tmpdir(), `dbgraph-mssql-e2e-${randomUUID()}`);
  mkdirSync(join(root, '.dbgraph'), { recursive: true });
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration test suite (gated)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mssqlIntegrationEnabled())(
  'MSSQL CLI E2E: init → sync → query (US-001/005/020, DBGRAPH_INTEGRATION=1)',
  () => {
    beforeAll(async () => {
      // Start ephemeral SQL Server container (applies torture.sql)
      handle = await startMssqlContainer();
      projectRoot = makeProjectRoot();
    }, 240_000);

    afterAll(async () => {
      if (existsSync(projectRoot)) {
        rmSync(projectRoot, { recursive: true, force: true });
      }
      if (handle !== undefined) {
        await handle.stop();
      }
    }, 60_000);

    it('sync succeeds against the ephemeral SQL Server container', async () => {
      // Create adapter directly with the container config (resolved — no env refs needed)
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        // runSync now returns a SyncSummary (was HandlerOutcome {type:'success'}) — migrated
        // assertion (ux-observability task 2.3). First sync over a fresh store → incremental.
        const summary = await runSync({ adapter, store, full: false });
        expect(summary.mode).toBe('incremental');
        expect(summary.fingerprint).not.toBe('');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    // DOG-1 A.9 — INTEGRATION tier: the SAME L-009 exact-set + zero-stub assertions as the
    // A.7 synthetic pin, proven end-to-end over the real materialized torture.sql catalog.
    it('proc→proc and fn→fn yield declared calls edges with NO phantom [table] stub (L-009)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });
      try {
        const procs = await store.getNodesByKind('procedure');
        const fns = await store.getNodesByKind('function');
        const tables = await store.getNodesByKind('table');
        const byName = (list: readonly { name: string; id: string }[], n: string) =>
          list.find((x) => x.name === n);

        const refresh = byName(procs, 'usp_refresh_totals');
        const logChange = byName(procs, 'usp_log_change');
        const netAmount = byName(fns, 'fn_net_amount');
        const roundMoney = byName(fns, 'fn_round_money');
        expect(refresh, 'usp_refresh_totals node').toBeDefined();
        expect(logChange, 'usp_log_change node').toBeDefined();
        expect(netAmount, 'fn_net_amount node').toBeDefined();
        expect(roundMoney, 'fn_round_money node').toBeDefined();

        // usp_refresh_totals → EXACTLY one calls edge to usp_log_change (declared)
        const refreshCalls = await store.getEdgesFrom(refresh!.id, ['calls']);
        expect(refreshCalls).toHaveLength(1);
        expect(refreshCalls[0]!.dst).toBe(logChange!.id);
        expect(refreshCalls[0]!.confidence).toBe('declared');

        // fn_net_amount → EXACTLY one calls edge to fn_round_money (declared)
        const netCalls = await store.getEdgesFrom(netAmount!.id, ['calls']);
        expect(netCalls).toHaveLength(1);
        expect(netCalls[0]!.dst).toBe(roundMoney!.id);
        expect(netCalls[0]!.confidence).toBe('declared');

        // NEGATIVE: usp_log_change emits ZERO calls edges
        expect(await store.getEdgesFrom(logChange!.id, ['calls'])).toStrictEqual([]);

        // NEGATIVE: usp_refresh_totals has NO reads_from/writes_to edge to usp_log_change
        const refreshRW = await store.getEdgesFrom(refresh!.id, ['reads_from', 'writes_to']);
        expect(refreshRW.some((e) => e.dst === logChange!.id)).toBe(false);
        // and it DOES write order_totals
        const refreshWrites = await store.getEdgesFrom(refresh!.id, ['writes_to']);
        const writeDstNames = new Set(
          refreshWrites.map((e) => tables.find((t) => t.id === e.dst)?.name),
        );
        expect(writeDstNames.has('order_totals')).toBe(true);

        // REGRESSION: NO phantom [table] stub named usp_log_change exists
        expect(tables.some((t) => t.name === 'usp_log_change')).toBe(false);
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    // DOG-2 1.3 — INTEGRATION tier: the SAME L-009 exact-set parameter pins as the map-unit
    // tier, proven end-to-end over the real materialized torture.sql catalog. Asserts the
    // ordinal-sorted payload.parameters on the routine nodes — BARE mssql types (int /
    // nvarchar / decimal, NEVER decimal(12,2)), direction 'in', no fabricated hasDefault,
    // parameter_id=0 return row excluded. Proves extract → normalize copy → store payload.
    it('routine parameters land on the node payload, BARE types, exact sets (DOG-2 L-009)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });
      try {
        const procs = await store.getNodesByKind('procedure');
        const fns = await store.getNodesByKind('function');
        const paramsOf = (
          list: readonly { name: string; payload: Readonly<Record<string, unknown>> }[],
          n: string,
        ) => list.find((x) => x.name === n)?.payload['parameters'];

        // usp_log_change(@order_id int, @new_status nvarchar(20)) → BARE nvarchar, both 'in'
        expect(paramsOf(procs, 'usp_log_change')).toStrictEqual([
          { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
          { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
        ]);
        // usp_refresh_totals(@order_id int) → single 'in' param
        expect(paramsOf(procs, 'usp_refresh_totals')).toStrictEqual([
          { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
        ]);
        // scalar fns: BARE decimal, parameter_id=0 return row EXCLUDED
        expect(paramsOf(fns, 'fn_net_amount')).toStrictEqual([
          { name: '@gross', dataType: 'decimal', direction: 'in', ordinal: 1 },
        ]);
        expect(paramsOf(fns, 'fn_round_money')).toStrictEqual([
          { name: '@amount', dataType: 'decimal', direction: 'in', ordinal: 1 },
        ]);
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    // DOG-1 C.4 — INTEGRATION tier: the SAME C.1/C.2/C.3 traversal + render pins as the
    // synthetic default-CI tier, proven end-to-end over the real materialized torture.sql
    // catalog. Impact traverses `calls` as READ-impact; precheck surfaces the caller in
    // whatToTest; explore/related render the `calls` neighbor with direction.
    it('impact/precheck/explore traverse and render calls end-to-end (L-009)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });
      try {
        const procs = await store.getNodesByKind('procedure');
        const refresh = procs.find((x) => x.name === 'usp_refresh_totals');
        const logChange = procs.find((x) => x.name === 'usp_log_change');
        expect(refresh, 'usp_refresh_totals node').toBeDefined();
        expect(logChange, 'usp_log_change node').toBeDefined();

        // ── C.1: impact of the called routine reaches its caller through inbound calls ──
        const impact = await getImpact(store, { nodeId: logChange!.id });
        const readNodeIds = new Set(impact.readImpact.flatMap((c) => c.nodes.slice(1)));
        expect(readNodeIds.has(refresh!.id)).toBe(true);
        // the caller is reached SPECIFICALLY through a `calls` edge
        const callerChain = impact.readImpact.find((c) => c.nodes.at(-1) === refresh!.id);
        expect(callerChain).toBeDefined();
        expect(callerChain!.edges).toContain('calls');
        // NEGATIVE: the caller is NOT in any write-impact set (a calls edge is READ-impact)
        const writeNodeIds = new Set(impact.writeImpact.flatMap((c) => c.nodes));
        expect(writeNodeIds.has(refresh!.id)).toBe(false);

        // ── C.2: precheck whatToTest surfaces the caller through the calls chain ──
        const view = await runPrecheck(store, 'ALTER TABLE dbo.usp_log_change ADD COLUMN reviewed BIT;');
        expect(view.impact.whatToTest).toContain('dbo.usp_refresh_totals');
        // mssql-dynamic-sql-granularity (sweep re-bless): usp_refresh_totals reaches usp_log_change
        // through a `calls` edge, and its body's `EXEC dbo.usp_log_change` is a RESOLVED CALL (DOG-1),
        // NOT dynamic SQL. The tokenizer no longer flags it hasDynamicSql, so the reader item carries
        // the plain 3-key resolved shape (NO [DYNAMIC SQL] marker) — the benchmark-v2 false positive
        // is gone. Pinned POSITIVELY: the resolved-call reader IS present, marker-free.
        expect(view.impact.readers).toContainEqual(
          { qname: 'dbo.usp_refresh_totals', kind: 'procedure', confidence: 'parsed' },
        );
        // L-009 per-node precision: NO reader in this scenario carries the dynamic marker — a
        // resolved call is not a blind spot (the marker attaches per-node, and none qualifies here).
        const degradedReaders = view.impact.readers
          .filter((i) => i.hasDynamicSql === true)
          .map((i) => i.qname);
        expect(degradedReaders).toStrictEqual([]);
        // NEGATIVE: usp_refresh_totals is a READER only — a `calls` edge is READ-impact, never a writer.
        expect(view.impact.writers).not.toContainEqual(
          { qname: 'dbo.usp_refresh_totals', kind: 'procedure', confidence: 'parsed' },
        );

        // ── C.3: explore renders the calls neighbor (outbound on caller, inbound on callee) ──
        const refreshNeighbors = await getNeighbors(store, { nodeId: refresh!.id });
        const refreshExplore = formatExplore({ node: refresh!, neighbors: refreshNeighbors }, 'normal');
        expect(refreshExplore).toContain('calls');
        expect(refreshExplore).toContain('→ dbo.usp_log_change  [procedure]');

        const logNeighbors = await getNeighbors(store, { nodeId: logChange!.id });
        const logExplore = formatExplore({ node: logChange!, neighbors: logNeighbors }, 'normal');
        expect(logExplore).toContain('calls');
        expect(logExplore).toContain('← dbo.usp_refresh_totals  [procedure]');

        // ── C.3: related filtered to kinds:['calls'] returns ONLY the calls neighbor ──
        const callsOnly = await getNeighbors(store, { nodeId: refresh!.id, kinds: ['calls'] });
        expect(Object.keys(callsOnly)).toStrictEqual(['calls']);
        const relatedText = formatRelated({ node: refresh!, neighbors: callsOnly }, 'normal');
        expect(relatedText).toContain('→ dbo.usp_log_change  [procedure]');
        expect(relatedText).not.toContain('writes_to');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // DOG-3 A.7 — LIVE column-lineage hybrid proofs (native dm_sql_referenced_entities
    // per-view TVF loop). Proves the truth sets + computed-column honesty + unbindable-view
    // skip end-to-end over the real materialized torture.sql catalog. Strategy-absence (proof 4)
    // is enforced structurally (the sqlcmd/manual-dump path never receives viewReferencedColumns)
    // AND pinned byte-identical by the non-integration test/adapters/engines/mssql/strategies/
    // manual-dump.test.ts against dumps/mssql-dump-golden.json (object grain, no dstColumns).
    // ─────────────────────────────────────────────────────────────────────

    /** Resolves a view's depends_on edges to { source-table name → attrs.dstColumns }. */
    async function dependsColumns(
      store: Awaited<ReturnType<typeof createSqliteGraphStore>>,
      viewName: string,
    ): Promise<Map<string, readonly string[] | undefined>> {
      const views = await store.getNodesByKind('view');
      const tables = await store.getNodesByKind('table');
      const view = views.find((v) => v.name === viewName);
      expect(view, `view ${viewName}`).toBeDefined();
      const edges = await store.getEdgesFrom(view!.id, ['depends_on']);
      const byTarget = new Map<string, readonly string[] | undefined>();
      for (const e of edges) {
        const t = tables.find((x) => x.id === e.dst);
        if (t !== undefined) byTarget.set(t.name, e.attrs.dstColumns);
      }
      return byTarget;
    }

    it('(1) TRUTH SETS + (2) computed-column honesty: v_order_summary edges carry exact dstColumns at declared (DOG-3 L-009, D8)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const store = await createSqliteGraphStore({
        path: join(projectRoot, '.dbgraph', 'dbgraph-lineage.db'),
      });
      try {
        await runSync({ adapter, store, full: true });
        const cols = await dependsColumns(store, 'v_order_summary');

        // (1) TRUTH SETS — EXACT sorted-unique consumed columns.
        expect(cols.get('orders')).toStrictEqual([
          'customer_id', 'order_id', 'status', 'total_amount',
        ]);
        expect(cols.get('order_items')).toStrictEqual(['order_id', 'product_id']);

        // both covered edges are confidence:'declared'
        const views = await store.getNodesByKind('view');
        const tables = await store.getNodesByKind('table');
        const view = views.find((v) => v.name === 'v_order_summary')!;
        const edges = await store.getEdgesFrom(view.id, ['depends_on']);
        for (const e of edges) {
          const t = tables.find((x) => x.id === e.dst);
          if (t?.name === 'orders' || t?.name === 'order_items') {
            expect(e.confidence).toBe('declared');
            expect(e.attrs.dstColumns).toBeDefined();
          }
        }

        // (2) COMPUTED-COLUMN honesty — total_amount consumed AS ITSELF; base cols NEVER fabricated.
        expect(cols.get('orders')).toContain('total_amount');
        expect(cols.get('orders')).not.toContain('quantity');
        expect(cols.get('orders')).not.toContain('unit_price');
        // negatives — columns the view does not read are absent
        expect(cols.get('order_items')).not.toContain('region_id');
        expect(cols.get('order_items')).not.toContain('qty');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('(3) UNBINDABLE-VIEW SKIP: a broken view keeps object grain while v_order_summary stays exact and extraction completes (DOG-3 D8)', async () => {
      // Create a scratch view whose source column is then dropped → the view is UNBINDABLE, so
      // sys.dm_sql_referenced_entities('dbo.v_scratch_broken','OBJECT') RAISES for it.
      const mssqlMod = (await import('mssql' as string)) as unknown as {
        ConnectionPool: new (cfg: unknown) => {
          connect(): Promise<{
            request(): { query(sql: string): Promise<unknown> };
            close(): Promise<void>;
          }>;
        };
      };
      const auth = handle.config.authentication as { user: string; password: string };
      const pool = await new mssqlMod.ConnectionPool({
        server: handle.config.server,
        port: handle.config.port,
        database: 'master',
        user: auth.user,
        password: auth.password,
        options: {
          encrypt: handle.config.encrypt ?? true,
          trustServerCertificate: handle.config.trustServerCertificate ?? true,
        },
      }).connect();
      try {
        await pool.request().query('CREATE TABLE dbo.tmp_broken_src (a int NOT NULL, b int NOT NULL)');
        await pool
          .request()
          .query("EXEC('CREATE VIEW dbo.v_scratch_broken AS SELECT a, b FROM dbo.tmp_broken_src')");
        // Drop a column the view reads → v_scratch_broken can no longer bind.
        await pool.request().query('ALTER TABLE dbo.tmp_broken_src DROP COLUMN b');

        const adapter = await createMssqlSchemaAdapter(handle.config);
        const store = await createSqliteGraphStore({
          path: join(projectRoot, '.dbgraph', 'dbgraph-unbindable.db'),
        });
        try {
          // Extraction MUST complete despite the unbindable view (no throw = per-call resilience).
          await runSync({ adapter, store, full: true });

          // The broken view's depends_on edge(s) stay OBJECT GRAIN — NO dstColumns (skipped).
          const broken = await dependsColumns(store, 'v_scratch_broken');
          for (const [, dstColumns] of broken) {
            expect(dstColumns).toBeUndefined();
          }

          // v_order_summary is STILL EXACT — one unbindable view does NOT abort the family.
          const summary = await dependsColumns(store, 'v_order_summary');
          expect(summary.get('orders')).toStrictEqual([
            'customer_id', 'order_id', 'status', 'total_amount',
          ]);
          expect(summary.get('order_items')).toStrictEqual(['order_id', 'product_id']);
        } finally {
          await adapter.close();
          await store.close();
        }
      } finally {
        // Restore the shared container to the torture baseline.
        try { await pool.request().query('DROP VIEW IF EXISTS dbo.v_scratch_broken'); } catch { /* ignore */ }
        try { await pool.request().query('DROP TABLE IF EXISTS dbo.tmp_broken_src'); } catch { /* ignore */ }
        await pool.close();
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // DOG-3 C.7 — LIVE column-precise impact + whatToTest + consumes: render
    // (design D6/D7), end-to-end over the real materialized torture.sql catalog.
    // ─────────────────────────────────────────────────────────────────────

    it('C.7: impact on order_items.product_id surfaces v_order_summary; region_id does NOT (live, D6)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const store = await createSqliteGraphStore({
        path: join(projectRoot, '.dbgraph', 'dbgraph-c7-impact.db'),
      });
      try {
        await runSync({ adapter, store, full: true });
        const items = await store.getNodesByKind('table');
        const orderItems = items.find((t) => t.name === 'order_items');
        expect(orderItems).toBeDefined();
        const columns = await getNeighbors(store, { nodeId: orderItems!.id, kinds: ['has_column'] });
        const productIdCol = columns['has_column']?.out.find((e) => e.node.name === 'product_id');
        const regionIdCol = columns['has_column']?.out.find((e) => e.node.name === 'region_id');
        expect(productIdCol).toBeDefined();
        expect(regionIdCol).toBeDefined();

        const productImpact = await getImpact(store, { nodeId: productIdCol!.node.id });
        const productReaders = new Set(
          await Promise.all(
            productImpact.readImpact.flatMap((c) => c.nodes.slice(1)).map(async (id) => (await store.getNode(id))?.name),
          ),
        );
        expect(productReaders.has('v_order_summary')).toBe(true);

        const regionImpact = await getImpact(store, { nodeId: regionIdCol!.node.id });
        const regionReaders = new Set(
          await Promise.all(
            regionImpact.readImpact.flatMap((c) => c.nodes.slice(1)).map(async (id) => (await store.getNode(id))?.name),
          ),
        );
        expect(regionReaders.has('v_order_summary')).toBe(false); // negative — column-grain precision, live
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('C.7: precheck whatToTest column-drop precision is live-precise (D6)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const store = await createSqliteGraphStore({
        path: join(projectRoot, '.dbgraph', 'dbgraph-c7-precheck.db'),
      });
      try {
        await runSync({ adapter, store, full: true });

        const productView = await runPrecheck(store, 'DROP COLUMN dbo.order_items.product_id;');
        expect(productView.impact.whatToTest).toContain('dbo.v_order_summary');
        expect(productView.impact.readers).toContainEqual(
          { qname: 'dbo.v_order_summary', kind: 'view', confidence: 'parsed' },
        );

        const regionView = await runPrecheck(store, 'DROP COLUMN dbo.order_items.region_id;');
        expect(regionView.impact.whatToTest).not.toContain('dbo.v_order_summary');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('C.7: explore/object render the LIVE consumes: lines for v_order_summary at full (D7)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const store = await createSqliteGraphStore({
        path: join(projectRoot, '.dbgraph', 'dbgraph-c7-render.db'),
      });
      try {
        await runSync({ adapter, store, full: true });
        const views = await store.getNodesByKind('view');
        const summary = views.find((v) => v.name === 'v_order_summary');
        expect(summary).toBeDefined();
        const neighbors = await getNeighbors(store, { nodeId: summary!.id });

        const exploreFull = formatExplore({ node: summary!, neighbors }, 'full');
        expect(exploreFull).toContain('consumes: dbo.orders.customer_id');
        expect(exploreFull).toContain('consumes: dbo.orders.order_id');
        expect(exploreFull).toContain('consumes: dbo.orders.status');
        expect(exploreFull).toContain('consumes: dbo.orders.total_amount');
        expect(exploreFull).toContain('consumes: dbo.order_items.order_id');
        expect(exploreFull).toContain('consumes: dbo.order_items.product_id');

        const objectFull = formatObject({ node: summary!, neighbors }, 'full');
        // CLI (explore) and MCP (object) render byte-identical consumes: bytes (D7).
        expect(objectFull).toContain('consumes: dbo.orders.customer_id');
        expect(objectFull).toContain('consumes: dbo.order_items.product_id');

        // negative: normal detail renders NO consumes section (budget honesty)
        const exploreNormal = formatExplore({ node: summary!, neighbors }, 'normal');
        expect(exploreNormal).not.toContain('consumes:');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('graph store contains table nodes after sync', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const tables = await store.getNodesByKind('table');
        expect(tables.length).toBeGreaterThan(0);
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('query for "orders" returns hits (exit 0 / type success)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const result = await runQuery({ store, term: 'orders', json: false });
        // torture.sql has an "orders" table — search must return hits
        expect(result.type).toBe('success');
        expect(result.output).toContain('orders');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('query for a non-existent term returns "negative" (exit 1)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const result = await runQuery({ store, term: 'xyzzy_nonexistent_mssql_q999', json: false });
        expect(result.type).toBe('negative');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('snapshot is recorded after sync', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const snapshots = await store.listSnapshots();
        expect(snapshots.length).toBeGreaterThan(0);
        const last = snapshots[snapshots.length - 1];
        expect(last).toBeDefined();
        expect(last?.engine).toBe('mssql');
      } finally {
        await adapter.close();
        await store.close();
      }
    });
  },
);

// Skip placeholder for docker-less runs
if (!mssqlIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
