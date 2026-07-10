/**
 * Tests for renderParameters (dog2-routine-parameters, Batch 2 task 2.1).
 * Spec: mcp-server "direction and default markers are UPPERCASE; `in` is unmarked" (MCP-2),
 *   "parameter order follows ordinal" (MCP-4). Design §3.3 D3.
 *
 * Pure renderer: node.payload.parameters → section-body lines. Grammar mirrors renderColumns —
 * `  <name>  <dataType>` (2-space indent, double-space gaps) + UPPERCASE [OUT]/[INOUT]/[DEFAULT]
 * double-space-joined; `in` renders NO marker; [DEFAULT] is PRESENCE-only (never the value).
 *
 * STRICT TDD: L-009 EXACT lines (.toStrictEqual the full string[]) + negatives (unset/empty → []).
 */

import { describe, it, expect } from 'vitest';
import { renderParameters } from '../../../src/core/present/payload.js';
import type { GraphNode } from '../../../src/index.js';

function routineNode(parameters: unknown, kind: GraphNode['kind'] = 'procedure'): GraphNode {
  const payload: Record<string, unknown> = { hasDynamicSql: false };
  if (parameters !== undefined) payload['parameters'] = parameters;
  return {
    id: 'node-procedure-x',
    kind,
    schema: 'dbo',
    name: 'x',
    qname: 'dbo.x',
    level: 'metadata',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload,
  };
}

describe('renderParameters — PARAMETERS section grammar (MCP-2/MCP-4, D3)', () => {
  it('renders header + `  name  type` lines; in carries NO marker (MCP-2)', () => {
    const node = routineNode([
      { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
    ]);
    expect(renderParameters(node)).toStrictEqual([
      'PARAMETERS',
      '  @order_id  int',
      '  @new_status  nvarchar',
    ]);
  });

  it('appends UPPERCASE [OUT]/[INOUT]/[DEFAULT] double-space-joined; in unmarked (MCP-2)', () => {
    const node = routineNode([
      { name: '@a', dataType: 'int', direction: 'out', ordinal: 1 },
      { name: '@b', dataType: 'int', direction: 'inout', ordinal: 2 },
      { name: '@c', dataType: 'int', direction: 'in', ordinal: 3 },
      { name: '@d', dataType: 'decimal', direction: 'in', ordinal: 4, hasDefault: true },
      { name: '@e', dataType: 'int', direction: 'out', ordinal: 5, hasDefault: true },
    ]);
    expect(renderParameters(node)).toStrictEqual([
      'PARAMETERS',
      '  @a  int  [OUT]',
      '  @b  int  [INOUT]',
      '  @c  int',
      '  @d  decimal  [DEFAULT]',
      '  @e  int  [OUT]  [DEFAULT]',
    ]);
  });

  it('renders in ascending ordinal regardless of input order (MCP-4)', () => {
    const node = routineNode([
      { name: '@second', dataType: 'int', direction: 'in', ordinal: 2 },
      { name: '@first', dataType: 'int', direction: 'in', ordinal: 1 },
    ]);
    expect(renderParameters(node)).toStrictEqual([
      'PARAMETERS',
      '  @first  int',
      '  @second  int',
    ]);
  });

  it('returns [] when parameters is UNSET — honest absence, no section', () => {
    expect(renderParameters(routineNode(undefined))).toStrictEqual([]);
  });

  it('returns [] when parameters is an EMPTY array — no section', () => {
    expect(renderParameters(routineNode([]))).toStrictEqual([]);
  });

  it('[DEFAULT] is a PRESENCE marker only — the default VALUE is never rendered', () => {
    const node = routineNode([
      { name: '@amount', dataType: 'decimal', direction: 'in', ordinal: 1, hasDefault: true },
    ]);
    const lines = renderParameters(node);
    expect(lines).toStrictEqual(['PARAMETERS', '  @amount  decimal  [DEFAULT]']);
    // NEGATIVE: no value token like "DEFAULT 0" leaks in (unlike the COLUMNS DEFAULT <value>).
    expect(lines.some((l) => /DEFAULT\s+\S/.test(l.replace('[DEFAULT]', '')))).toBe(false);
  });
});
