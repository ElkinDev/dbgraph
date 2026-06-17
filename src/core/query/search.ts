/**
 * search — US-011: full-text search over FTS-indexed graph nodes.
 * Design §6.4 — delegates to port.searchFts (FTS5 via adapter), with a TS-side
 * Levenshtein fallback when FTS returns no results (typo tolerance).
 *
 * GOLDEN-PINNED constants (ADR-008 — determinism):
 *   LEVENSHTEIN_THRESHOLD = 2  (max edit distance for fallback match)
 *   TYPO_CAP              = 5  (max results returned by fallback)
 *
 * These MUST NOT be changed without updating goldens and the apply-progress log.
 *
 * ADR-004: imports only core. ADR-007: no new dependencies (Levenshtein in-lined here).
 */

import type { GraphStore, SearchQuery, SearchHit } from '../ports/graph-store.js';
import { NODE_KINDS } from '../model/node.js';

// ─────────────────────────────────────────────────────────────────────────────
// Golden-pinned constants (ADR-008 / design §6.4)
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum Levenshtein edit distance for a typo-fallback match. */
export const LEVENSHTEIN_THRESHOLD = 2 as const;

/** Maximum number of results returned by the typo-fallback path. */
export const TYPO_CAP = 5 as const;

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  readonly total: number;
}

/**
 * Searches the graph by full-text term.
 *
 * 1. Build an FTS5-compatible prefix query from the term tokens and call
 *    `store.searchFts`. Results are ranked by BM25 (the adapter handles that).
 * 2. If FTS returns zero results, run the TS-side Levenshtein fallback:
 *    - Gather candidate qnames from all non-stub nodes (fetched per-kind via port).
 *    - Compute Levenshtein distance between the term and each qname's local name.
 *    - Return up to TYPO_CAP results with distance ≤ LEVENSHTEIN_THRESHOLD,
 *      sorted by (distance ASC, qname ASC) for determinism (ADR-008).
 * 3. Propagate `limit`/`offset` to the FTS call; the fallback respects TYPO_CAP.
 */
export async function search(store: GraphStore, q: SearchQuery): Promise<SearchResult> {
  const ftsQuery = buildFtsQuery(q.term);
  const ftsResult = await store.searchFts(ftsQuery, {
    ...(q.limit !== undefined ? { limit: q.limit } : {}),
    ...(q.offset !== undefined ? { offset: q.offset } : {}),
  });

  if (ftsResult.hits.length > 0) {
    return { hits: ftsResult.hits, total: ftsResult.total };
  }

  // ── Levenshtein fallback (US-011 typo tolerance) ───────────────────────────
  const fallbackHits = await levenshteinFallback(store, q.term);
  return { hits: fallbackHits, total: fallbackHits.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// FTS query builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a user term into an FTS5 prefix-token query.
 * Each whitespace-delimited token becomes a prefix match (token*).
 * Tokens are OR-combined across columns.
 *
 * @example 'orders status' → '"orders*" OR "status*"'
 * @example 'custmer'       → '"custmer*"'
 */
function buildFtsQuery(term: string): string {
  const tokens = term
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return '""';

  // Wrap each token in quotes and append * for prefix matching
  return tokens.map((t) => `"${escapeFtsToken(t)}*"`).join(' OR ');
}

/** Escapes special FTS5 characters in a token. */
function escapeFtsToken(token: string): string {
  // FTS5 special characters: " \ — escape double-quotes
  return token.replace(/"/g, '""');
}

// ─────────────────────────────────────────────────────────────────────────────
// Levenshtein fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a bounded Levenshtein scan over all node qnames in the store.
 */
async function levenshteinFallback(store: GraphStore, term: string): Promise<SearchHit[]> {
  const normalizedTerm = term.trim().toLowerCase();

  // Collect candidates via getNodesByKind for each kind (NODE_KINDS from model — legal import per ADR-004)
  const candidates: Array<{ id: string; kind: (typeof NODE_KINDS)[number]; qname: string; name: string }> = [];

  for (const kind of NODE_KINDS) {
    const nodes = await store.getNodesByKind(kind);
    for (const node of nodes) {
      if (node.missing || node.excluded) continue;
      candidates.push({
        id: node.id,
        kind: node.kind,
        qname: node.qname,
        name: node.name,
      });
    }
  }

  // Compute Levenshtein distances and filter
  const scored: Array<{ hit: SearchHit; distance: number }> = [];

  for (const c of candidates) {
    // Compare against local name (last segment of qname)
    const dist = levenshtein(normalizedTerm, c.name.toLowerCase());
    if (dist <= LEVENSHTEIN_THRESHOLD) {
      scored.push({
        hit: {
          id: c.id,
          kind: c.kind,
          qname: c.qname,
          column: 'qname',
          score: dist,
        },
        distance: dist,
      });
    }
  }

  // Sort by (distance ASC, qname ASC) — ADR-008 determinism
  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.hit.qname.localeCompare(b.hit.qname);
  });

  return scored.slice(0, TYPO_CAP).map((s) => s.hit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Levenshtein distance (iterative, two-row, O(n) space)
// ADR-007: no new dependency — implemented inline from first principles.
// ─────────────────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use explicit number[] (not sparse) so elements are never undefined at valid indices.
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] ?? b.length;
}
