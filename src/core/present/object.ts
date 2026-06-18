/**
 * formatObject — task 1.3 (phase-5-mcp-server).
 * Spec: dbgraph_object assembles full detail; Metadata-level states body omitted.
 * Design: PURE, core-types-only, golden-pinned. Lives in src/core/present/ per ADR-004.
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (ObjectView, ObjectDetail) → byte-identical string.
 *
 * --detail levels:
 *   brief  — header + annotation counts (idx/trg counts)
 *   normal — brief + columns (type/null/default), PK/FK/check constraints
 *   full   — normal + indexes (cols+kind), triggers (event), body for full-level modules
 */

import type { GraphNode } from '../model/node.js';
import type { NeighborGroups } from '../ports/graph-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** The detail level for object output. */
export type ObjectDetail = 'brief' | 'normal' | 'full';

/**
 * Input bundle for formatObject.
 * Assembled by the caller from getNodeByQName + getNeighbors.
 */
export interface ObjectView {
  readonly node: GraphNode;
  readonly neighbors: NeighborGroups;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatObject — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats an ObjectView into a human-readable string at the requested detail level.
 *
 * Output contract (ADR-008):
 *   - Same (view, detail) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatObject(view: ObjectView, detail: ObjectDetail): string {
  const lines: string[] = [];

  // ── Collect neighbor counts for annotation ─────────────────────────────────
  const indexGroup = view.neighbors['has_index'];
  const triggerGroup = view.neighbors['fires_on'];
  const constraintGroup = view.neighbors['has_constraint'];
  const columnGroup = view.neighbors['has_column'];

  const indexCount = indexGroup ? indexGroup.out.length : 0;
  const triggerCount = triggerGroup ? triggerGroup.in.length : 0;

  // ── Header (all levels) ───────────────────────────────────────────────────
  const annotations: string[] = [];
  if (indexCount > 0) annotations.push(`${indexCount} idx`);
  if (triggerCount > 0) annotations.push(`${triggerCount} trg!`);
  const annotSuffix = annotations.length > 0 ? `  [${annotations.join(', ')}]` : '';
  lines.push(`${view.node.qname}  [${view.node.kind}]${annotSuffix}`);
  lines.push('─'.repeat(Math.min(60, view.node.qname.length + view.node.kind.length + 4)));

  if (detail === 'brief') {
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── COLUMNS section (normal + full) ───────────────────────────────────────
  // Access payload fields via bracket notation (NodePayload is Readonly<Record<string,unknown>>).
  // We guard each access with a runtime check, then cast to the expected type.
  const columns = columnGroup
    ? [...columnGroup.out].sort((a, b) => {
        const aOrd = (a.node.payload['ordinal'] as number | undefined) ?? 0;
        const bOrd = (b.node.payload['ordinal'] as number | undefined) ?? 0;
        return aOrd - bOrd;
      })
    : [];

  // Collect PK/FK columns for annotation
  const pkColumns = new Set<string>();
  const fkMap = new Map<string, string>(); // colname → target ref

  if (constraintGroup) {
    for (const entry of constraintGroup.out) {
      const p = entry.node.payload;
      const ctype = p['type'] as string | undefined;
      const cols = p['columns'] as readonly string[] | undefined;
      if (ctype === 'PK' && cols !== undefined) {
        for (const col of cols) pkColumns.add(col);
      } else if (ctype === 'FK' && cols !== undefined) {
        const def = p['definition'] as string | undefined;
        if (def !== undefined) {
          for (const col of cols) fkMap.set(col, def);
        }
      }
    }
  }

  if (columns.length > 0) {
    lines.push('');
    lines.push('COLUMNS');
    for (const entry of columns) {
      const p = entry.node.payload;
      const dataType = (p['dataType'] as string | undefined) ?? 'unknown';
      const nullable = p['nullable'] as boolean | undefined;
      const defaultVal = p['default'] as string | undefined | null;

      const parts: string[] = [`  ${entry.node.name}  ${dataType}`];

      if (pkColumns.has(entry.node.name)) parts.push('[PK]');
      if (fkMap.has(entry.node.name)) parts.push(`[FK→${fkMap.get(entry.node.name) ?? ''}]`);
      if (nullable === false && !pkColumns.has(entry.node.name)) parts.push('[NN]');

      if (defaultVal !== undefined && defaultVal !== null) {
        parts.push(`DEFAULT ${defaultVal}`);
      }

      lines.push(parts.join('  '));
    }
  }

  // ── CONSTRAINTS section (normal + full) ───────────────────────────────────
  if (constraintGroup && constraintGroup.out.length > 0) {
    const constraints = [...constraintGroup.out].sort((a, b) => a.node.name.localeCompare(b.node.name));
    lines.push('');
    lines.push('CONSTRAINTS');
    for (const entry of constraints) {
      const p = entry.node.payload;
      const ctype = (p['type'] as string | undefined) ?? '';
      const cols = (p['columns'] as readonly string[] | undefined) ?? [];
      const def = p['definition'] as string | undefined;
      if (ctype === 'FK' && def !== undefined) {
        lines.push(`  [${ctype}]  ${entry.node.name}  (${cols.join(', ')} → ${def})`);
      } else {
        lines.push(`  [${ctype}]  ${entry.node.name}  (${cols.join(', ')})`);
      }
    }
  }

  if (detail === 'normal') {
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── INDEXES section (full only) ───────────────────────────────────────────
  if (indexGroup && indexGroup.out.length > 0) {
    const indexes = [...indexGroup.out].sort((a, b) => a.node.name.localeCompare(b.node.name));
    lines.push('');
    lines.push('INDEXES');
    for (const entry of indexes) {
      const p = entry.node.payload;
      const unique = p['unique'] as boolean | undefined;
      const cols = (p['columns'] as readonly string[] | undefined) ?? [];
      const method = p['method'] as string | undefined;
      const uniqueLabel = unique ? 'UNIQUE ' : '';
      const methodStr = method ? ` [${method}]` : '';
      lines.push(`  ${entry.node.name}  ${uniqueLabel}(${cols.join(', ')})${methodStr}`);
    }
  }

  // ── TRIGGERS section (full only) ──────────────────────────────────────────
  if (triggerGroup && triggerGroup.in.length > 0) {
    const triggers = [...triggerGroup.in].sort((a, b) => a.node.name.localeCompare(b.node.name));
    lines.push('');
    lines.push('TRIGGERS');
    for (const entry of triggers) {
      const p = entry.node.payload;
      const timing = (p['timing'] as string | undefined) ?? '';
      const events = ((p['events'] as readonly string[] | undefined) ?? []).join(', ');
      lines.push(`  ${entry.node.name}  ${timing} ${events}`.trimEnd());
    }
  }

  // ── Body section (full only, for modules at full level) ───────────────────
  const isModule = view.node.kind === 'procedure' || view.node.kind === 'function' || view.node.kind === 'trigger';
  if (isModule) {
    lines.push('');
    if (view.node.level === 'full') {
      const body = view.node.payload['body'] as string | undefined;
      if (body !== undefined && body !== null) {
        lines.push('BODY');
        lines.push(body);
      } else {
        lines.push('BODY (body omitted — not indexed at full level)');
      }
    } else {
      // metadata level: explicitly state body is omitted
      lines.push('BODY (body omitted — object indexed at metadata level)');
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
