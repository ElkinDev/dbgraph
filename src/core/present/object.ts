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
import {
  deriveColumnAnnotations,
  renderColumns,
  renderConstraints,
  renderIndexes,
  renderTriggers,
  renderParameters,
} from './payload.js';

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
  const referencesGroup = view.neighbors['references'];

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

  // ── Payload sections via the shared pure renderers (design D1) ─────────────
  // Renderers return section-body lines WITHOUT a leading blank; the caller keeps
  // the inter-section push('') cadence so today's bytes are reproduced exactly.
  const columns = columnGroup ? columnGroup.out : [];
  const constraints = constraintGroup ? constraintGroup.out : [];
  const references = referencesGroup ? referencesGroup.out : [];
  const annots = deriveColumnAnnotations(constraints, references);

  // ── COLUMNS section (normal + full) ───────────────────────────────────────
  const columnLines = renderColumns(columns, annots);
  if (columnLines.length > 0) {
    lines.push('');
    lines.push(...columnLines);
  }

  // ── CONSTRAINTS section (normal + full) ───────────────────────────────────
  const constraintLines = renderConstraints(constraints, annots);
  if (constraintLines.length > 0) {
    lines.push('');
    lines.push(...constraintLines);
  }

  // ── PARAMETERS section (normal + full) — DOG-2 §3.4 D3 ─────────────────────
  // formatObject does NOT call renderFocusPayload, so it needs its OWN block calling the SAME
  // shared renderParameters (design §9 understatement — task 2.3). Placed AFTER CONSTRAINTS and
  // BEFORE the normal early-return so it renders at normal AND full (never brief) — the identical
  // detail gating explore uses. The shared helper guarantees byte-identical bytes across surfaces.
  const parameterLines = renderParameters(view.node);
  if (parameterLines.length > 0) {
    lines.push('');
    lines.push(...parameterLines);
  }

  if (detail === 'normal') {
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── INDEXES section (full only) ───────────────────────────────────────────
  const indexLines = renderIndexes(indexGroup ? indexGroup.out : []);
  if (indexLines.length > 0) {
    lines.push('');
    lines.push(...indexLines);
  }

  // ── TRIGGERS section (full only) ──────────────────────────────────────────
  const triggerLines = renderTriggers(triggerGroup ? triggerGroup.in : []);
  if (triggerLines.length > 0) {
    lines.push('');
    lines.push(...triggerLines);
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
