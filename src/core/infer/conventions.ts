/**
 * Column naming-convention patterns and hand-rolled singular/plural helpers.
 * Design D5 — zero-dep, no new npm dependencies (ADR-007).
 * Pure string functions; ZERO imports (no core model types needed).
 * ADR-004: no adapter/driver/cli/mcp/child_process/I/O.
 * ADR-008: deterministic (same input → same output, order stable).
 * US-008
 */

// ─────────────────────────────────────────────────────────────────────────────
// extractEntity — naming convention pattern matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The result of a successful convention match.
 * `entity` is the extracted candidate entity name (lowercased).
 * `conv` is the convention weight: 1.0 for `<e>_id`/`<e>Id`, 0.8 for `id_<e>`.
 */
export interface EntityMatch {
  readonly entity: string;
  readonly conv: number;
}

/**
 * Extracts the candidate entity name from a column/field name using
 * the three recognized naming conventions (case-folded):
 *
 *   - `<entity>_id`  (snake suffix)   → conv: 1.0
 *   - `<entity>Id`   (camelCase)      → conv: 1.0
 *   - `id_<entity>`  (snake prefix)   → conv: 0.8
 *
 * Returns `null` when the name matches none of the patterns, or when
 * the entity part would be empty (e.g. bare `id`).
 *
 * All matching and returned strings are lowercased (case-folded).
 *
 * @example
 *   extractEntity('customer_id')   // → { entity: 'customer', conv: 1.0 }
 *   extractEntity('customerId')    // → { entity: 'customer', conv: 1.0 }
 *   extractEntity('id_product')    // → { entity: 'product',  conv: 0.8 }
 *   extractEntity('name')          // → null
 *   extractEntity('id')            // → null  (no entity part)
 */
export function extractEntity(colName: string): EntityMatch | null {
  const folded = colName.toLowerCase();

  // ── Pattern 1: <entity>_id (snake suffix) — conv: 1.0 ────────────────────
  if (folded.endsWith('_id')) {
    const entity = folded.slice(0, -3); // strip '_id'
    if (entity.length > 0) {
      return { entity, conv: 1.0 };
    }
    return null;
  }

  // ── Pattern 2: <entity>Id or <entity>ID (camelCase suffix) — conv: 1.0 ───
  // Match a lowercased 'id' suffix that was preceded by an uppercase I in the
  // original string, i.e. the original had 'Id' or 'ID' as a word boundary.
  // We detect this by looking at the original (case-sensitive) string.
  // Check: original ends with 'Id' or 'ID', and there's something before it.
  if (colName.endsWith('Id') || colName.endsWith('ID')) {
    const suffixLen = colName.endsWith('Id') ? 2 : 2;
    const entity = colName.slice(0, colName.length - suffixLen).toLowerCase();
    if (entity.length > 0) {
      return { entity, conv: 1.0 };
    }
    return null;
  }

  // ── Pattern 3: id_<entity> (snake prefix) — conv: 0.8 ────────────────────
  if (folded.startsWith('id_')) {
    const entity = folded.slice(3); // strip 'id_'
    if (entity.length > 0) {
      return { entity, conv: 0.8 };
    }
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// candidateTargets — hand-rolled singular/plural generation (D5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the full set of singular/plural candidate target names for a given
 * entity name using hand-rolled rules (zero dependencies, ADR-007).
 *
 * Rules applied in order (D5):
 *   1. name as-is
 *   2. name + 's'
 *   3. name + 'es'
 *   4. if name ends in 'y': replace trailing 'y' with 'ies'
 *   5. singular: if name ends in 'ies' → replace with 'y';
 *                else if name ends in 'es' (length > 2) → strip 'es';
 *                else if name ends in 's' (length > 1) → strip 's'
 *
 * The result is DEDUPED (later duplicates of earlier entries are dropped)
 * and the order is deterministic.
 *
 * The correctness of over-generated forms is validated downstream by matching
 * ONLY against real target nodes in the graph — over-generation is safe here.
 *
 * @example
 *   candidateTargets('customer')   // → ['customer', 'customers', 'customeres']
 *   candidateTargets('customers')  // → ['customers', 'customerss', 'customerses', 'customer']
 *   candidateTargets('category')   // → ['category', 'categorys', 'categoryes', 'categories']
 */
export function candidateTargets(entity: string): readonly string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  function add(s: string): void {
    if (!seen.has(s)) {
      seen.add(s);
      candidates.push(s);
    }
  }

  // Rule 1: as-is
  add(entity);

  // Rule 2: +s
  add(`${entity}s`);

  // Rule 3: +es
  add(`${entity}es`);

  // Rule 4: -y→-ies
  if (entity.endsWith('y')) {
    add(`${entity.slice(0, -1)}ies`);
  }

  // Rule 5: singular forms
  if (entity.endsWith('ies') && entity.length > 3) {
    // -ies → -y
    add(`${entity.slice(0, -3)}y`);
  } else if (entity.endsWith('es') && entity.length > 2) {
    // strip trailing 'es'
    add(entity.slice(0, -2));
  } else if (entity.endsWith('s') && entity.length > 1) {
    // strip trailing 's'
    add(entity.slice(0, -1));
  }

  return candidates;
}
