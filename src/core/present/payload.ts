/**
 * payload.ts — change explore-payloads (US-036).
 * Spec: mcp-server "One shared payload-render helper backs explore and object";
 *   cli-config "explore output comes from a pure formatter shared with the MCP tool".
 *
 * ONE pure module rendering the per-kind node payload as section-body lines. Both
 * `formatObject` and `formatExplore` consume these renderers so the section bytes are
 * byte-identical across surfaces (no per-surface branch, no drift — design D1/D2).
 *
 * Contract (design D1):
 *   - Each renderer returns the section HEADER + one body row per entry, WITHOUT a
 *     leading blank separator. Callers keep the inter-section `push('')` cadence, so
 *     today's exact bytes are reproduced (refactor transparency).
 *   - Each renderer returns [] when its group is empty.
 *   - deriveColumnAnnotations computes the PK set + FK colname→target map ONCE. FK
 *     target precedence (design D8): constraint payload `definition` when present,
 *     else reconstructed from the `references` edges when unambiguous (Batch B),
 *     else omitted — never guessed.
 *
 * ADR-004: imports ONLY core model types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic — same input → byte-identical string[]. No Date/env/random/I/O.
 */

import type { GraphNode, RoutineParameter } from '../model/node.js';
import type { GraphEdge } from '../model/edge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** A neighbor entry as returned by getNeighbors — the node plus its connecting edge. */
export interface NeighborEntry {
  readonly node: GraphNode;
  readonly edge?: GraphEdge;
}

/** Column-level annotations derived once from a node's constraint + references neighbors. */
export interface ColumnAnnotations {
  /** Column names that participate in the primary key. */
  readonly pk: ReadonlySet<string>;
  /** FK column name → rendered target (payload definition, or reconstructed table-level qname). */
  readonly fk: ReadonlyMap<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveColumnAnnotations — PK set + FK target map (payload-present path; D8 in Batch B)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the PK column set and the FK colname→target map from a node's constraint
 * neighbors. FK target precedence (design D8):
 *   1. constraint payload `definition` present → rendered verbatim (column-level target).
 *   2. (Batch B) payload target absent → reconstructed table-level target from the
 *      `references` edges when unambiguous.
 *   3. ambiguous / no resolvable target → omitted (honest degradation, never guessed).
 */
export function deriveColumnAnnotations(
  constraints: readonly NeighborEntry[],
  references: readonly NeighborEntry[],
): ColumnAnnotations {
  const pk = new Set<string>();
  const fk = new Map<string, string>();

  // Count FK constraints up front — the "only FK" reconstruction fallback (D8) needs it.
  const fkCount = constraints.filter((e) => e.node.payload['type'] === 'FK').length;

  for (const entry of constraints) {
    const p = entry.node.payload;
    const ctype = p['type'] as string | undefined;
    const cols = p['columns'] as readonly string[] | undefined;
    if (ctype === 'PK' && cols !== undefined) {
      for (const col of cols) pk.add(col);
    } else if (ctype === 'FK' && cols !== undefined) {
      const def = p['definition'] as string | undefined;
      if (def !== undefined) {
        // D8 precedence 1: payload target present → render verbatim (column-level).
        for (const col of cols) fk.set(col, def);
        continue;
      }
      // D8 precedence 2: reconstruct the TABLE-level target from `references` edges,
      // joined per-constraint via attrs.constraintName; unambiguous iff a single
      // distinct target table results. Fall back to all references when this is the
      // table's ONLY FK. Otherwise degrade (precedence 3) — never guess.
      const target = reconstructFkTarget(entry.node.name, references, fkCount);
      if (target !== undefined) {
        for (const col of cols) fk.set(col, target);
      }
    }
  }

  return { pk, fk };
}

/**
 * Reconstructs an FK's table-level target qname from the `references` edges (D8).
 * Returns the single distinct target qname when unambiguous, else undefined (degrade).
 */
function reconstructFkTarget(
  constraintName: string,
  references: readonly NeighborEntry[],
  fkCount: number,
): string | undefined {
  const matched = references.filter((e) => e.edge?.attrs.constraintName === constraintName);
  // Per-constraint join when several FKs exist; else fall back to all references when
  // this is the table's ONLY FK (the references then unambiguously belong to it).
  const candidates = matched.length > 0 ? matched : fkCount === 1 ? references : [];

  const targets = new Set<string>();
  for (const e of candidates) targets.add(e.node.qname);

  if (targets.size === 1) {
    const [only] = targets;
    return only;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind section renderers — section header + body rows, [] when empty
// ─────────────────────────────────────────────────────────────────────────────

/** COLUMNS section: one row per column with type + PK/FK/NN markers and DEFAULT. */
export function renderColumns(columns: readonly NeighborEntry[], a: ColumnAnnotations): string[] {
  if (columns.length === 0) return [];

  const sorted = [...columns].sort((x, y) => {
    const xOrd = (x.node.payload['ordinal'] as number | undefined) ?? 0;
    const yOrd = (y.node.payload['ordinal'] as number | undefined) ?? 0;
    return xOrd - yOrd;
  });

  const lines: string[] = ['COLUMNS'];
  for (const entry of sorted) {
    const p = entry.node.payload;
    const dataType = (p['dataType'] as string | undefined) ?? 'unknown';
    const nullable = p['nullable'] as boolean | undefined;
    const defaultVal = p['default'] as string | undefined | null;
    const name = entry.node.name;

    const parts: string[] = [`  ${name}  ${dataType}`];
    if (a.pk.has(name)) parts.push('[PK]');
    if (a.fk.has(name)) parts.push(`[FK→${a.fk.get(name) ?? ''}]`);
    if (nullable === false && !a.pk.has(name)) parts.push('[NN]');
    if (defaultVal !== undefined && defaultVal !== null) {
      parts.push(`DEFAULT ${defaultVal}`);
    }
    lines.push(parts.join('  '));
  }
  return lines;
}

/** CONSTRAINTS section: one row per constraint, FK column→target mapping via `a.fk`. */
export function renderConstraints(constraints: readonly NeighborEntry[], a: ColumnAnnotations): string[] {
  if (constraints.length === 0) return [];

  const sorted = [...constraints].sort((x, y) => x.node.name.localeCompare(y.node.name));

  const lines: string[] = ['CONSTRAINTS'];
  for (const entry of sorted) {
    const p = entry.node.payload;
    const ctype = (p['type'] as string | undefined) ?? '';
    const cols = (p['columns'] as readonly string[] | undefined) ?? [];
    const firstCol = cols[0];
    const target = firstCol !== undefined ? a.fk.get(firstCol) : undefined;
    if (ctype === 'FK' && target !== undefined) {
      lines.push(`  [${ctype}]  ${entry.node.name}  (${cols.join(', ')} → ${target})`);
    } else {
      lines.push(`  [${ctype}]  ${entry.node.name}  (${cols.join(', ')})`);
    }
  }
  return lines;
}

/** INDEXES section: one row per index with UNIQUE + columns + optional [method]. */
export function renderIndexes(indexes: readonly NeighborEntry[]): string[] {
  if (indexes.length === 0) return [];

  const sorted = [...indexes].sort((x, y) => x.node.name.localeCompare(y.node.name));

  const lines: string[] = ['INDEXES'];
  for (const entry of sorted) {
    const p = entry.node.payload;
    const unique = p['unique'] as boolean | undefined;
    const cols = (p['columns'] as readonly string[] | undefined) ?? [];
    const method = p['method'] as string | undefined;
    const uniqueLabel = unique ? 'UNIQUE ' : '';
    const methodStr = method ? ` [${method}]` : '';
    lines.push(`  ${entry.node.name}  ${uniqueLabel}(${cols.join(', ')})${methodStr}`);
  }
  return lines;
}

/**
 * PARAMETERS section: one row per routine parameter, ascending ordinal (DOG-2 §3.3 D3).
 * Grammar mirrors renderColumns exactly — `  <name>  <dataType>` (2-space indent, double-space
 * gap) then UPPERCASE bracket markers joined by two spaces, matching the COLUMNS convention
 * [PK]/[FK→]/[NN]. An `in` parameter renders NO direction marker (the default, like a nullable
 * column shows no [NN]). [DEFAULT] is a PRESENCE marker only — the parameter default VALUE is
 * out of scope, so parameters expose only the flag (unlike COLUMNS' DEFAULT <value>). Returns []
 * when parameters is UNSET or EMPTY → honest absence, no section (SQLite renders nothing).
 */
export function renderParameters(node: GraphNode): string[] {
  const params = node.payload['parameters'] as readonly RoutineParameter[] | undefined;
  if (params === undefined || params.length === 0) return [];

  const sorted = [...params].sort((a, b) => a.ordinal - b.ordinal);
  const lines: string[] = ['PARAMETERS'];
  for (const p of sorted) {
    const parts: string[] = [`  ${p.name}  ${p.dataType}`];
    if (p.direction === 'out') parts.push('[OUT]');
    else if (p.direction === 'inout') parts.push('[INOUT]');
    if (p.hasDefault === true) parts.push('[DEFAULT]');
    lines.push(parts.join('  '));
  }
  return lines;
}

/** TRIGGERS section: one row per trigger with timing + events (from the fires_on.in group). */
export function renderTriggers(triggers: readonly NeighborEntry[]): string[] {
  if (triggers.length === 0) return [];

  const sorted = [...triggers].sort((x, y) => x.node.name.localeCompare(y.node.name));

  const lines: string[] = ['TRIGGERS'];
  for (const entry of sorted) {
    const p = entry.node.payload;
    const timing = (p['timing'] as string | undefined) ?? '';
    const events = ((p['events'] as readonly string[] | undefined) ?? []).join(', ');
    lines.push(`  ${entry.node.name}  ${timing} ${events}`.trimEnd());
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// renderFocusPayload — explore NON-container focus (column/constraint/index/trigger)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_ANNOTATIONS: ColumnAnnotations = { pk: new Set<string>(), fk: new Map<string, string>() };

/**
 * Renders a single non-container focus node's OWN per-kind payload line(s) using the
 * SAME per-kind grammar as the section renderers (design D2). PK/FK markers appear on a
 * column focus ONLY when parent-context annotations `a` are supplied; a bare column focus
 * still shows type/nullable/default. Returns [] for a kind that has no focus payload line
 * (e.g. a table/view — those render their full sections instead).
 */
export function renderFocusPayload(node: GraphNode, a?: ColumnAnnotations): string[] {
  const ann = a ?? EMPTY_ANNOTATIONS;
  const single: readonly NeighborEntry[] = [{ node }];
  switch (node.kind) {
    case 'column':
    case 'field':
      return renderColumns(single, ann);
    case 'constraint':
      return renderConstraints(single, ann);
    case 'index':
      return renderIndexes(single);
    case 'trigger':
      return renderTriggers(single);
    case 'procedure':
    case 'function':
      // DOG-2 §3.4 D3: a routine focus renders its PARAMETERS section via the ONE shared
      // helper — explore (+ MCP dbgraph_explore) inherits it here for free (explore.ts routes
      // non-container focus through renderFocusPayload). formatObject wires the SAME helper.
      return renderParameters(node);
    default:
      return [];
  }
}
