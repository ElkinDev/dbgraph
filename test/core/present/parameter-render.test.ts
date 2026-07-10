/**
 * NEW parameter-render present golden family (dog2-routine-parameters, Batch 2 task 2.4).
 * Spec: mcp-server MCP-1 (exact lines, byte-identical across surfaces), MCP-5 (non-routine /
 *   unset-parameters focus renders NO section). Design §3.3/§3.4 D3, §6 golden blast-radius.
 *
 * Pins the routine-focus PARAMETERS section end-to-end through the two shared surfaces
 * (explore + object) at `normal`, byte-identical (ADR-008). The mssql usp_log_change exact lines
 * and a mixed out/inout/default set are golden-locked; the negatives (TABLE focus, UNSET-params
 * routine) assert NO section. Goldens seed on first run, then compare byte-for-byte.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatExplore, type ExploreView } from '../../../src/core/present/explore.js';
import { formatObject, type ObjectView } from '../../../src/core/present/object.js';
import type { GraphNode, NeighborGroups } from '../../../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

function routineNode(
  name: string,
  parameters: readonly unknown[] | undefined,
  kind: 'procedure' | 'function' = 'procedure',
): GraphNode {
  const payload: Record<string, unknown> = { hasDynamicSql: false };
  if (parameters !== undefined) payload['parameters'] = parameters;
  return {
    id: `node-${kind}-${name}`,
    kind,
    schema: 'dbo',
    name,
    qname: `dbo.${name}`,
    level: 'metadata',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload,
  };
}

const TABLE_NODE: GraphNode = {
  id: 'node-orders',
  kind: 'table',
  schema: 'dbo',
  name: 'orders',
  qname: 'dbo.orders',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { rowCountEstimate: 500 },
};

const NO_NEIGHBORS: NeighborGroups = {};

// A mixed set exercising every marker: in (unmarked), out, inout, default, out+default.
const MIXED = [
  { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
  { name: '@new_status', dataType: 'nvarchar', direction: 'out', ordinal: 2 },
  { name: '@rowcount', dataType: 'int', direction: 'inout', ordinal: 3 },
  { name: '@amount', dataType: 'decimal', direction: 'in', ordinal: 4, hasDefault: true },
];

/** Golden read/seed helper (seeds on first run, byte-compares thereafter — ADR-008). */
function assertGolden(name: string, actual: string): void {
  const path = join(goldenDir, name);
  if (!existsSync(path)) {
    writeFileSync(path, actual, 'utf-8');
    expect(actual.length).toBeGreaterThan(0);
    return;
  }
  expect(actual).toBe(readFileSync(path, 'utf-8'));
}

describe('parameter-render golden family — routine focus, explore + object (MCP-1)', () => {
  const mixedExplore: ExploreView = { node: routineNode('usp_mixed', MIXED), neighbors: NO_NEIGHBORS };
  const mixedObject: ObjectView = { node: routineNode('usp_mixed', MIXED), neighbors: NO_NEIGHBORS };

  it('explore normal routine focus matches golden', () => {
    assertGolden('param-render-explore-normal.txt', formatExplore(mixedExplore, 'normal'));
  });

  it('object normal routine focus matches golden', () => {
    assertGolden('param-render-object-normal.txt', formatObject(mixedObject, 'normal'));
  });

  it('mssql usp_log_change exact PARAMETERS lines are byte-locked (MCP-1)', () => {
    const params = [
      { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
    ];
    const block = ['PARAMETERS', '  @order_id  int', '  @new_status  nvarchar'].join('\n');
    const view = { node: routineNode('usp_log_change', params), neighbors: NO_NEIGHBORS };
    expect(formatExplore(view, 'normal')).toContain(block);
    expect(formatObject(view, 'normal')).toContain(block);
  });

  it('the mixed set renders every marker exactly (in unmarked / OUT / INOUT / DEFAULT)', () => {
    const block = [
      'PARAMETERS',
      '  @order_id  int',
      '  @new_status  nvarchar  [OUT]',
      '  @rowcount  int  [INOUT]',
      '  @amount  decimal  [DEFAULT]',
    ].join('\n');
    expect(formatObject(mixedObject, 'normal')).toContain(block);
    expect(formatExplore(mixedExplore, 'normal')).toContain(block);
  });
});

describe('parameter-render negatives — no section for non-routine / unset (MCP-5)', () => {
  it('a TABLE focus renders NO PARAMETERS section', () => {
    const view = { node: TABLE_NODE, neighbors: NO_NEIGHBORS };
    expect(formatExplore(view, 'normal')).not.toContain('PARAMETERS');
    expect(formatObject(view, 'normal')).not.toContain('PARAMETERS');
  });

  it('a routine whose parameters is UNSET renders NO PARAMETERS section', () => {
    const view = { node: routineNode('usp_noparams', undefined), neighbors: NO_NEIGHBORS };
    expect(formatExplore(view, 'normal')).not.toContain('PARAMETERS');
    expect(formatObject(view, 'normal')).not.toContain('PARAMETERS');
  });
});
