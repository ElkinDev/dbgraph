/**
 * Routine PARAMETERS wiring across explore + object (dog2-routine-parameters, Batch 2 tasks 2.2/2.3).
 * Spec: mcp-server MCP-1 (byte-identical across surfaces via the ONE shared helper),
 *   MCP-3 (detail-gated to normal/full, absent at brief). Design §3.4 D3.
 *
 * 2.2: renderFocusPayload gains procedure/function → renderParameters(node); explore.ts already
 *      routes non-container focus through it, so explore (+ MCP dbgraph_explore) gets it for free.
 * 2.3: formatObject gets its OWN PARAMETERS block (it does NOT call renderFocusPayload) — the
 *      design §9 understatement; without it object/MCP-object would silently omit parameters.
 *
 * STRICT TDD: L-009 EXACT lines + byte-identity between the two surfaces + brief-absence negatives.
 */

import { describe, it, expect } from 'vitest';
import { formatExplore, type ExploreView } from '../../../src/core/present/explore.js';
import { formatObject, type ObjectView } from '../../../src/core/present/object.js';
import { renderFocusPayload } from '../../../src/core/present/payload.js';
import type { GraphNode, NeighborGroups } from '../../../src/index.js';

const PARAMS = [
  { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
  { name: '@new_status', dataType: 'nvarchar', direction: 'out', ordinal: 2 },
  { name: '@amount', dataType: 'decimal', direction: 'in', ordinal: 3, hasDefault: true },
];

const EXPECTED_SECTION = [
  'PARAMETERS',
  '  @order_id  int',
  '  @new_status  nvarchar  [OUT]',
  '  @amount  decimal  [DEFAULT]',
];

function routineNode(kind: 'procedure' | 'function' = 'procedure'): GraphNode {
  return {
    id: `node-${kind}-usp_log_change`,
    kind,
    schema: 'dbo',
    name: 'usp_log_change',
    qname: 'dbo.usp_log_change',
    level: 'metadata',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: { hasDynamicSql: false, parameters: PARAMS },
  };
}

const NO_NEIGHBORS: NeighborGroups = {};

const EXPECTED_BLOCK = EXPECTED_SECTION.join('\n');

describe('renderFocusPayload — routine focus routes to renderParameters (2.2, D3)', () => {
  it('a procedure focus renders the PARAMETERS lines', () => {
    expect(renderFocusPayload(routineNode('procedure'))).toStrictEqual(EXPECTED_SECTION);
  });
  it('a function focus renders the PARAMETERS lines', () => {
    expect(renderFocusPayload(routineNode('function'))).toStrictEqual(EXPECTED_SECTION);
  });
});

describe('explore — routine focus PARAMETERS section, detail-gated (2.2, MCP-3)', () => {
  const view: ExploreView = { node: routineNode(), neighbors: NO_NEIGHBORS };

  it('normal emits the exact PARAMETERS section (byte-exact block)', () => {
    expect(formatExplore(view, 'normal')).toContain(EXPECTED_BLOCK);
  });
  it('full emits the exact PARAMETERS section (byte-exact block)', () => {
    expect(formatExplore(view, 'full')).toContain(EXPECTED_BLOCK);
  });
  it('brief emits NO PARAMETERS section (negative)', () => {
    expect(formatExplore(view, 'brief')).not.toContain('PARAMETERS');
  });
});

describe('object — routine focus PARAMETERS section, detail-gated (2.3, MCP-3)', () => {
  const view: ObjectView = { node: routineNode(), neighbors: NO_NEIGHBORS };

  it('normal emits the exact PARAMETERS section (byte-exact block)', () => {
    expect(formatObject(view, 'normal')).toContain(EXPECTED_BLOCK);
  });
  it('full emits the exact PARAMETERS section (byte-exact block)', () => {
    expect(formatObject(view, 'full')).toContain(EXPECTED_BLOCK);
  });
  it('brief emits NO PARAMETERS section (negative)', () => {
    expect(formatObject(view, 'brief')).not.toContain('PARAMETERS');
  });
});

describe('explore and object render BYTE-IDENTICAL PARAMETERS bytes (2.3, MCP-1)', () => {
  it('the same node yields the identical exact section block across both surfaces (shared source)', () => {
    const node = routineNode();
    // Both surfaces embed the SAME renderParameters output verbatim — proving no per-surface branch.
    expect(formatExplore({ node, neighbors: NO_NEIGHBORS }, 'normal')).toContain(EXPECTED_BLOCK);
    expect(formatObject({ node, neighbors: NO_NEIGHBORS }, 'normal')).toContain(EXPECTED_BLOCK);
  });
});
