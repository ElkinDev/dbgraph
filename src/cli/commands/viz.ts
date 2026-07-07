/**
 * viz command handler — change graph-viz, Batch 3 (design §"CLI adapter: handleViz").
 * Spec: cli-config "viz command exports the graph and honors the exit-code contract" +
 * graph-viz "viz exports one self-contained offline HTML with zero network at view time".
 *
 * IMPURE assembly ONLY (ADR-004): imports ONLY the public barrel (`src/index.ts`) + Node
 * builtins + CLI siblings — NEVER `src/adapters/**`. The deterministic work (collapse,
 * community, data block, mermaid) is the pure `src/core/viz` layer reached via the barrel;
 * this file validates flags, opens the store, bulk-reads it in EXACTLY two calls, assembles
 * the self-contained HTML from the embedded (offline) assets, and writes the file.
 *
 * Flag matrix (Q5): validate up front and THROW `ConfigError` (exit 2) — never silently
 * coerce or no-op (the `parseDetail` precedent). `--mermaid` emits a PURE ER diagram, so
 * every viewer-shaping flag is contradictory with it.
 */

import { writeFileSync } from 'node:fs';
import type { GraphStore, NodeKind, VizOptions, VizGraphData } from '../../index.js';
import { ConfigError, NODE_KINDS, openConnections, buildVizData, emitMermaidER } from '../../index.js';
import type { HandlerOutcome } from '../dispatch.js';
import { assembleVizHtml } from './viz/assets.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** A validated viz invocation: which mode, where to write, and the shaping options. */
export interface VizInvocation {
  /** True for `--mermaid` (pure ER text); false for the interactive HTML export. */
  readonly mermaid: boolean;
  /** Output path, or null for the default (`graph.html` for HTML; STDOUT for `--mermaid`). */
  readonly out: string | null;
  /** Shaping options for `buildVizData` (unused in `--mermaid` mode). */
  readonly options: VizOptions;
}

/** The assembled export payload, ready to write. */
export interface VizExport {
  readonly mermaid: boolean;
  readonly content: string;
  /** Resolved output path, or null when `--mermaid` writes to STDOUT. */
  readonly outPath: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flag parsing + the Q5 invalid-combination matrix
// ─────────────────────────────────────────────────────────────────────────────

type FlagValue = string | true | undefined;

/** A viewer-shaping flag is one that only makes sense for the HTML export, not `--mermaid`. */
const VIEWER_FLAGS: readonly { readonly key: string; readonly name: string }[] = [
  { key: 'full', name: '--full' },
  { key: 'columns', name: '--columns' },
  { key: 'kinds', name: '--kinds' },
  { key: 'schema', name: '--schema' },
  { key: 'min-degree', name: '--min-degree' },
];

/** True when a flag is present at all (string value OR bare boolean). */
function present(v: FlagValue): boolean {
  return v !== undefined;
}

/**
 * Validates the parsed flags into a {@link VizInvocation}, THROWING {@link ConfigError}
 * (exit 2) for any invalid value or contradictory combination — the Q5 matrix. Pure: no
 * I/O, no store access (mirrors `parseDetail` — errors surface BEFORE any DB open).
 */
export function parseVizOptions(flags: Readonly<Record<string, string | true>>): VizInvocation {
  const mermaid = flags['mermaid'] === true;
  const out = typeof flags['out'] === 'string' ? flags['out'] : null;

  // ── `--mermaid` cannot be combined with any viewer-shaping flag ──────────────
  if (mermaid) {
    for (const { key, name } of VIEWER_FLAGS) {
      if (present(flags[key])) {
        throw new ConfigError(
          `--mermaid emits a pure ER diagram and cannot be combined with viewer flag ${name} (drop ${name} or --mermaid).`,
        );
      }
    }
    return { mermaid: true, out, options: { full: false } };
  }

  const full = flags['full'] === true;
  const columns = flags['columns'] === true;

  // ── `--full` combinations ────────────────────────────────────────────────────
  if (full && present(flags['kinds'])) {
    throw new ConfigError('--full renders every kind and cannot be combined with the --kinds allowlist.');
  }
  if (full && columns) {
    throw new ConfigError('--columns is implied by --full; pass one, not both.');
  }

  // ── `--min-degree` must be a non-negative integer ────────────────────────────
  let minDegree: number | undefined;
  const rawMinDegree = flags['min-degree'];
  if (rawMinDegree !== undefined) {
    const s = rawMinDegree === true ? '' : rawMinDegree;
    if (!/^\d+$/.test(s)) {
      throw new ConfigError(`--min-degree must be a non-negative integer, got "${s}".`);
    }
    minDegree = Number.parseInt(s, 10);
  }

  // ── `--kinds` must be a comma-separated allowlist of known node kinds ────────
  let kinds: readonly NodeKind[] | undefined;
  const rawKinds = flags['kinds'];
  if (rawKinds !== undefined) {
    const s = rawKinds === true ? '' : rawKinds;
    const requested = s.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
    if (requested.length === 0) {
      throw new ConfigError(`--kinds requires a comma-separated list of node kinds (valid: ${NODE_KINDS.join(', ')}).`);
    }
    for (const k of requested) {
      if (!(NODE_KINDS as readonly string[]).includes(k)) {
        throw new ConfigError(`--kinds contains unknown kind "${k}" (valid: ${NODE_KINDS.join(', ')}).`);
      }
    }
    kinds = requested as readonly NodeKind[];
  }

  // ── `--schema` must be a non-empty name ──────────────────────────────────────
  let schema: string | undefined;
  const rawSchema = flags['schema'];
  if (rawSchema !== undefined) {
    if (rawSchema === true || rawSchema.length === 0) {
      throw new ConfigError('--schema requires a non-empty schema name.');
    }
    schema = rawSchema;
  }

  // Conditional spread keeps optional fields absent (exactOptionalPropertyTypes).
  const options: VizOptions = {
    full,
    ...(columns ? { columns: true } : {}),
    ...(schema !== undefined ? { schema } : {}),
    ...(minDegree !== undefined ? { minDegree } : {}),
    ...(kinds !== undefined ? { kinds } : {}),
  };
  return { mermaid: false, out, options };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export builder — EXACTLY two whole-graph store reads (Q3), then pure assembly
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic serialization of the embedded data block (stable key + element order). */
function serializeDataBlock(data: VizGraphData): string {
  return JSON.stringify(data);
}

/**
 * Reads the whole graph in EXACTLY two store calls (`getAllNodes` + `getAllEdges`) and
 * builds either the Mermaid ER text or the self-contained HTML. Makes NO per-node/per-edge
 * store calls (Q3 bounded-query ceiling — proven by the counting-store test). Pure beyond
 * the two bulk reads; does NOT touch the filesystem (the caller writes the output).
 */
export async function buildVizExport(store: GraphStore, inv: VizInvocation): Promise<VizExport> {
  const nodes = await store.getAllNodes();
  const edges = await store.getAllEdges();

  if (inv.mermaid) {
    return { mermaid: true, content: emitMermaidER(nodes, edges), outPath: inv.out };
  }

  const dataJson = serializeDataBlock(buildVizData(nodes, edges, inv.options));
  const html = assembleVizHtml(dataJson);
  return { mermaid: false, content: html, outPath: inv.out ?? 'graph.html' };
}

// ─────────────────────────────────────────────────────────────────────────────
// handleViz — the dispatch handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates flags (ConfigError matrix → exit 2), opens the store, bulk-reads it, assembles
 * the output, writes it (or STDOUTs the Mermaid text), and prints a one-line confirmation
 * carrying the output path. Returns success (exit 0). ADR-004: no adapter import, no
 * process.exit (cli.ts owns that).
 */
export async function handleViz(args: {
  readonly flags: Readonly<Record<string, string | true>>;
}): Promise<HandlerOutcome> {
  // Validate up front — a bogus flag throws a ConfigError BEFORE any DB access (Q5).
  const inv = parseVizOptions(args.flags);
  const projectRoot = process.cwd();

  const { adapter, store } = await openConnections(projectRoot);
  try {
    const result = await buildVizExport(store, inv);

    if (result.outPath === null) {
      // `--mermaid` with no `--out`: the ER text IS the output (STDOUT), no confirmation.
      process.stdout.write(result.content);
      return { type: 'success' };
    }

    writeFileSync(result.outPath, result.content, 'utf-8');
    const what = result.mermaid ? 'Mermaid ER diagram' : 'self-contained graph HTML';
    process.stdout.write(`Wrote ${what} to ${result.outPath}\n`);
    return { type: 'success' };
  } finally {
    await adapter.close();
    await store.close();
  }
}
