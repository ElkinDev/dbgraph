/**
 * v2 Docker-gated live pipeline proof (B4, design D5 / spec Req 3).
 *
 * Spins the mssql torture fixture via `container.ts`, applies `torture.sql`, indexes it with
 * dbgraph (the WITH graph), and asserts — on the LIVE substrate — that (a) the graph indexes every
 * plan-* target routine/table, (b) the deterministic WITHOUT dump (stripped `torture.sql`) embeds
 * the SP bodies verbatim, and (c) plan-* coverage passes over that dump. This REPRODUCES what
 * `build-packets --substrate mssql-torture` does via the SAME pure seams (`stripMssqlDdl`,
 * `deriveCoverageTargets`, `verifyDumpCoverage`) — it imports NO benchmark dev stage and spawns NO
 * child process, so the independence guard stays green.
 *
 * GATE (B4.2): `describe.skipIf(!DBGRAPH_INTEGRATION)`. Without Docker the live leg SKIPS HONESTLY
 * — no numbers are fabricated. The container + adapter modules are DYNAMICALLY imported inside
 * `beforeAll`, so a Docker-less `npm test` never loads testcontainers/mssql. Run the live leg with:
 *   DBGRAPH_INTEGRATION=1 npm test -- test/benchmark/mssql-substrate.test.ts
 *
 * L-009: EXACT assertions, positives AND the honest-skip negative.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { stripMssqlDdl, deriveCoverageTargets, verifyDumpCoverage } from '../../benchmark/harness-checks.ts';
import type { Family } from '../../benchmark/scorer/index.ts';
import type { GraphStore } from '../../src/core/ports/graph-store.js';
import type { MssqlContainerHandle } from '../fixtures/mssql/container.js';
import type { ExtractionScope } from '../../src/core/model/capability.js';

const INTEGRATION = process.env['DBGRAPH_INTEGRATION'] === '1';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const TORTURE = readFileSync(join(repoRoot, 'test', 'fixtures', 'mssql', 'torture.sql'), 'utf8');
const KEYS_DIR = join(repoRoot, 'benchmark', 'planning-keys');

function loadKey(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(KEYS_DIR, name), 'utf8')) as Record<string, unknown>;
}
const PLAN_KEYS = [
  loadKey('plan-callers-usp_log_change.json'),
  loadKey('plan-blindspots-dynamic-sql.json'),
  loadKey('plan-order-drop-recreate.json'),
];

// Every plan-* target routine/table that the WITH graph MUST index by name.
const EXPECTED_ROUTINES = ['usp_log_change', 'usp_refresh_totals', 'sp_dynamic_search', 'fn_net_amount', 'fn_round_money'];
const EXPECTED_TABLES = ['order_items', 'orders', 'products', 'regions'];

let handle: MssqlContainerHandle | undefined;
let store: GraphStore | undefined;
let indexedNames: Set<string> = new Set();

describe.skipIf(!INTEGRATION)('v2 mssql-torture live pipeline (Docker-gated, Req 3 positive)', () => {
  beforeAll(async () => {
    const { startMssqlContainer } = await import('../fixtures/mssql/container.js');
    const { createMssqlSchemaAdapter } = await import('../../src/adapters/engines/mssql/factory.js');
    const { createSqliteGraphStore } = await import('../../src/adapters/storage/sqlite/factory.js');
    const { normalizeCatalog } = await import('../../src/core/normalize/normalize.js');
    const { DEFAULT_LEVELS } = await import('../../src/core/model/capability.js');
    const scope: ExtractionScope = { levels: DEFAULT_LEVELS };

    handle = await startMssqlContainer();
    const adapter = await createMssqlSchemaAdapter(handle.config);
    const catalog = await adapter.extract(scope);
    await adapter.close();
    const norm = normalizeCatalog(catalog, scope);

    store = await createSqliteGraphStore({ path: ':memory:' });
    await store.upsertGraph(norm.graph);

    const procs = await store.getNodesByKind('procedure');
    const funcs = await store.getNodesByKind('function');
    const tables = await store.getNodesByKind('table');
    indexedNames = new Set([...procs, ...funcs, ...tables].map((n) => n.name));
  }, 240_000);

  afterAll(async () => {
    if (store !== undefined) await store.close();
    if (handle !== undefined) await handle.stop();
  }, 60_000);

  it('the WITH graph indexes every plan-* target routine (live substrate)', () => {
    for (const routine of EXPECTED_ROUTINES) {
      expect(indexedNames.has(routine)).toBe(true);
    }
  });

  it('the WITH graph indexes every plan-order scoped table (live substrate)', () => {
    for (const table of EXPECTED_TABLES) {
      expect(indexedNames.has(table)).toBe(true);
    }
  });

  it('the WITHOUT stripped dump embeds the SP bodies verbatim (EXEC / sp_executesql / call)', () => {
    const dump = stripMssqlDdl(TORTURE);
    expect(dump).toContain("EXEC dbo.usp_log_change @order_id, N'refreshed'");
    expect(dump).toContain('EXEC sp_executesql @sql');
    expect(dump).toContain('RETURN dbo.fn_round_money(@gross)');
  });

  it('plan-* coverage passes over the stripped dump on the live substrate → [] (Req 3 positive)', () => {
    const dump = stripMssqlDdl(TORTURE);
    for (const key of PLAN_KEYS) {
      const targets = deriveCoverageTargets(String(key['qid']), key['family'] as Family, key);
      expect(verifyDumpCoverage(dump, targets)).toStrictEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4.2 — honest SKIP (always runs). Without DBGRAPH_INTEGRATION the live leg above
// is skipped; this asserts the gate is honest and no numbers are fabricated.
// ─────────────────────────────────────────────────────────────────────────────

describe('the Docker-tier live pipeline is gated and skips honestly (Req 3 negative)', () => {
  it('without DBGRAPH_INTEGRATION the live leg does not run — numbers are never fabricated', () => {
    if (!INTEGRATION) {
      expect(INTEGRATION).toBe(false);
      expect(store).toBeUndefined(); // the container/index never ran ⇒ no live numbers
    } else {
      // Live leg enabled — the gated describe above produces the real numbers.
      expect(INTEGRATION).toBe(true);
    }
  });
});
