/**
 * Task 3.7a/3.7b — RED→GREEN: the bounded-query ceiling + the CLI import boundary.
 *
 * (a) BOUNDED (Q3) — a viz export issues EXACTLY 2 whole-graph reads (`getAllNodes` +
 *     `getAllEdges`), ≤ 3 total store reads, and NEVER a per-node/per-edge read
 *     (`getNode`/`getNodesByKind`/`getEdgesFrom`/`getEdgesTo`) — independent of node count.
 *     Proven with the CountingStore decorator introduced in Batch 2 (task 2.3).
 * (b) BOUNDARY — `src/cli/commands/viz.ts` imports ONLY the public barrel (`src/index.ts`)
 *     + Node builtins + CLI siblings; NEVER `src/adapters/**` (ADR-004). The repo-wide CLI
 *     boundary test scans it automatically; here we pin viz.ts explicitly.
 *
 * Spec `cli-config` "viz honors the CLI import boundary" + `graph-storage` "whole-graph read
 * uses a bounded number of queries" (command ≤3 half). L-009: toBe(N), no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVizExport, parseVizOptions } from '../../../src/cli/commands/viz.js';
import { CountingStore } from '../../helpers/counting-store.js';
import { openFixtureStore, type FixtureStore } from '../../mcp/fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const vizSrc = join(here, '..', '..', '..', 'src', 'cli', 'commands', 'viz.ts');

let fx: FixtureStore;
beforeAll(async () => { fx = await openFixtureStore(); });
afterAll(async () => { await fx.cleanup(); });

describe('viz export is bounded to 2 whole-graph reads (task 3.7a, Q3)', () => {
  it('HTML export issues exactly getAllNodes×1 + getAllEdges×1, no per-node storm', async () => {
    const counting = new CountingStore(fx.store);
    const out = await buildVizExport(counting, parseVizOptions({}));

    expect(counting.counts.getAllNodes).toBe(1);
    expect(counting.counts.getAllEdges).toBe(1);
    expect(counting.wholeGraphReads).toBe(2);
    expect(counting.totalReads).toBeLessThanOrEqual(3);
    expect(counting.counts.getNode).toBe(0);
    expect(counting.counts.getNodesByKind).toBe(0);
    expect(counting.counts.getEdgesFrom).toBe(0);
    expect(counting.counts.getEdgesTo).toBe(0);

    // the 2 reads yielded MANY nodes/edges — independent of node count (no N-per-node)
    const block = out.content.match(/<script id="dbgraph-data"[^>]*>([\s\S]*?)<\/script>/)![1]!;
    const data = JSON.parse(block) as { nodes: unknown[] };
    expect(data.nodes.length).toBeGreaterThan(counting.totalReads);
  });

  it('--mermaid export is ALSO bounded to exactly 2 whole-graph reads', async () => {
    const counting = new CountingStore(fx.store);
    await buildVizExport(counting, parseVizOptions({ mermaid: true }));
    expect(counting.counts.getAllNodes).toBe(1);
    expect(counting.counts.getAllEdges).toBe(1);
    expect(counting.wholeGraphReads).toBe(2);
    expect(counting.counts.getNode).toBe(0);
    expect(counting.counts.getNodesByKind).toBe(0);
  });
});

describe('viz.ts honors the CLI import boundary (task 3.7b, ADR-004)', () => {
  it('imports only the barrel / node builtins / CLI siblings — never src/adapters', () => {
    const src = readFileSync(vizSrc, 'utf-8');
    const specifiers: string[] = [];
    const re = /(?:import|export)\s+(?:type\s+)?(?:[\w,{}\s*]+\s+from\s+)?['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) if (m[1] !== undefined) specifiers.push(m[1]);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(spec.includes('/adapters/')).toBe(false);
      expect(spec.includes('/mcp/')).toBe(false);
      const legal =
        spec === '../../index.js' ||
        spec.startsWith('node:') ||
        spec.startsWith('./') ||
        spec.startsWith('../');
      expect(legal).toBe(true);
    }
  });
});
