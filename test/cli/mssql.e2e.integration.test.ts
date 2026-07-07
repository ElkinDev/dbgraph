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
        expect(view.impact.readers).toContainEqual(
          { qname: 'dbo.usp_refresh_totals', kind: 'procedure', confidence: 'parsed' },
        );
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
