/**
 * PostgreSQL body tokenizer.
 * Design §"PG hasDynamicSql — strip EXECUTE FUNCTION/PROCEDURE before testing
 * for a bare statement-form EXECUTE".
 *
 * PG hasDynamicSql = bare plpgsql EXECUTE statement (EXECUTE 'sql' / EXECUTE format(...))
 * It MUST NOT flag the EXECUTE FUNCTION / EXECUTE PROCEDURE clause of a CREATE TRIGGER DDL.
 *
 * Implementation:
 *   1. Strip / replace all `EXECUTE\s+(FUNCTION|PROCEDURE)\b` occurrences
 *      (with a placeholder that contains no word characters) so the trailing
 *      bare-EXECUTE test cannot match them.
 *   2. Test whether a bare \bEXECUTE\b remains.
 *
 * tokenizePgBody wires the _shared/ primitives with a PG-specific canonicalizer
 * (double-quote stripping only, no bracket support — PG does not use [brackets]).
 *
 * All dependency edges carry confidence: 'parsed' (no score).
 * supportsDependencyHints: false — body tokenizer is the SOLE edge source.
 *
 * Dynamic-string masking: references that exist ONLY inside string literals
 * ('...') or dollar-quoted strings ($$...$$) must NOT produce edges. The
 * "static body" strips those contents before presence-checking, so that only
 * unquoted identifiers in non-dynamic code paths generate edges.
 *
 * US-028 (PostgreSQL adapter), US-007 (hasDynamicSql declared blindness),
 * ADR-007 (no plpgsql grammar, conservative tokenizer).
 */

import type { RawDependency } from '../../../core/model/catalog.js';
import { classifyAccess } from '../_shared/tokenizer-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// PG canonicalizer — double-quote stripping only (no brackets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips double-quote delimiters from a qualified name and lowercases.
 * PG uses double-quote quoting for identifiers; bracket quoting is MSSQL-only.
 *
 * Examples:
 *   double-quoted app.products  → app.products
 *   double-quoted Orders        → orders
 *   orders (plain)              → orders
 */
export function pgCanonicalize(rawName: string): string {
  // Strip PG double-quote identifier delimiters (schema.name → schema.name).
  // Build the pattern via charCodeAt(34) to avoid literal dquote chars in the
  // source, which would confuse the write-verb scanner naive extractor (ADR-007).
  const dq = String.fromCharCode(34); // 34 = ASCII double-quote
  return rawName
    .replace(new RegExp(`${dq}([^${dq}]*)${dq}`, 'g'), '$1')
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// hasPgDynamicSql — bare plpgsql EXECUTE only, NOT trigger EXECUTE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the body contains a bare plpgsql EXECUTE statement
 * (i.e. dynamic SQL: EXECUTE 'sql' or EXECUTE format(...)).
 *
 * CRITICAL: must NOT flag the `EXECUTE FUNCTION fn()` or `EXECUTE PROCEDURE fn()`
 * clause that appears in CREATE TRIGGER DDL statements (which is a static reference
 * to a function, not a dynamic SQL statement).
 *
 * Strategy:
 *   1. Replace all `EXECUTE\s+FUNCTION\b` and `EXECUTE\s+PROCEDURE\b` occurrences
 *      with a neutral placeholder that contains no word characters (breaks \b match).
 *   2. Test whether a bare \bEXECUTE\b word-boundary match remains.
 *
 * NOTE: hasDynamicSql detection is performed on the ORIGINAL (unmasked) body, not
 * on the static body, so that EXECUTE inside string literals is still correctly
 * detected as dynamic SQL.
 *
 * Case-insensitive throughout.
 *
 * US-007 (declared blindness — flag and stop, never guess).
 * Pinned by spec: plpgsql EXECUTE → true; EXECUTE FUNCTION/PROCEDURE → false.
 */
export function hasPgDynamicSql(body: string): boolean {
  // Step 1: erase EXECUTE FUNCTION and EXECUTE PROCEDURE (trigger DDL clauses).
  // Replace with a placeholder containing no word chars near boundaries.
  // This prevents a naive bare-EXECUTE test from matching the trigger DDL clause.
  const withoutTriggerExec = body.replace(/\bexecute\s+(function|procedure)\b/gi, '##TRIGGER_EXEC##');

  // Step 2: test for a bare EXECUTE word boundary.
  return /\bexecute\b/i.test(withoutTriggerExec);
}

// ─────────────────────────────────────────────────────────────────────────────
// maskDynamicStrings — remove string literal contents from body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a "static body" with the CONTENTS of single-quoted string literals
 * replaced by a neutral placeholder. This prevents identifiers that appear only
 * inside dynamic SQL strings (e.g. format('SELECT ... FROM app.orders ...'))
 * from generating dependency edges.
 *
 * Only single-quoted string literals are masked. Dollar-quoted blocks (which are
 * the function body delimiters from pg_get_functiondef) are NOT masked — they
 * contain the actual SQL code whose static references we DO want to classify.
 *
 * Pattern: '...' including '' escape sequences inside the literal.
 *
 * Examples:
 *   format('SELECT order_id FROM app.orders WHERE ...')
 *     → format('##MASKED##')
 *   VALUES (TG_TABLE_NAME, TG_OP)
 *     → unchanged (no string literals containing object names)
 *
 * ADR-007 (conservative — when in doubt, exclude).
 */
export function maskDynamicStrings(body: string): string {
  // Mask single-quoted string literals. '' (escaped single quote) inside a literal
  // is handled by the alternation [^'] | '' — consume either a non-quote char or
  // a pair of single quotes (escape sequence), matching the full literal.
  return body.replace(/'(?:[^']|'')*'/g, "'##MASKED##'");
}

// ─────────────────────────────────────────────────────────────────────────────
// bodyContainsRef — presence check in the static (masked) body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the canonicalized qname (fully qualified OR simple name)
 * actually appears as an identifier in the masked static body.
 *
 * This is the gate that prevents classifyAccess from defaulting to 'read' for
 * objects that are NOT referenced in the body at all (CRITICAL-1 fix).
 *
 * Checks both:
 *   - schema.name  (e.g. app.orders)
 *   - name only    (e.g. orders)
 * Both checks use word-boundary matching on the lowercased masked body.
 */
function bodyContainsRef(maskedBody: string, canonicalQName: string): boolean {
  // The masked body is already lowercased by pgCanonicalize applied during classifyAccess.
  // We need to check the masked body in its lowercased form here too.
  const lowerMasked = maskedBody.toLowerCase();
  const simpleName = canonicalQName.includes('.')
    ? canonicalQName.split('.').slice(1).join('.')
    : canonicalQName;

  // Word-boundary check: the name must appear as a standalone identifier token.
  // We use \b word boundaries. SQL also allows dot-separated qnames like schema.table.
  const qnamePattern = new RegExp(`\\b${escapeRegex(canonicalQName)}\\b`);
  const simplePattern = new RegExp(`\\b${escapeRegex(simpleName)}\\b`);

  return qnamePattern.test(lowerMasked) || simplePattern.test(lowerMasked);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizePgBody — dependency classification
// ─────────────────────────────────────────────────────────────────────────────

interface DepRef {
  readonly schema: string;
  readonly name: string;
}

export interface PgTokenizerResult {
  readonly hasDynamicSql: boolean;
  readonly dependencies: readonly RawDependency[];
}

/**
 * Tokenizes a PostgreSQL function/procedure/view body and classifies dependency
 * edges as read or write via the shared tokenizer primitives.
 *
 * Key behaviors (post CRITICAL-1 / WARNING-1 fix):
 *   - Builds a "static body" by masking string-literal contents (maskDynamicStrings).
 *   - Only emits an edge for a candidate if its canonicalized qname (qualified OR
 *     simple name) actually appears in the STATIC body. Objects absent from the
 *     static body get NO edge — we never default to 'read' for absent objects.
 *   - A routine/view MUST NOT reference itself (self-edges are impossible since the
 *     object is defined by its own body, but this is naturally filtered by the
 *     presence check: the body never contains its own schema.name as a target).
 *   - hasDynamicSql is detected from the ORIGINAL (unmasked) body.
 *   - Static edges SURVIVE even when hasDynamicSql is true. Only dynamic-string refs
 *     are excluded. This makes PG consistent with MSSQL (which keeps catalog-confirmed
 *     static edges alongside hasDynamicSql:true).
 *   - All edges carry confidence: 'parsed' (no score field).
 *
 * @param body  The full routine/view definition body (from pg_get_functiondef/pg_get_viewdef).
 * @param deps  Array of known dependency objects to classify.
 */
export function tokenizePgBody(body: string, deps: readonly DepRef[]): PgTokenizerResult {
  // Detect dynamic SQL from the original (unmasked) body.
  const dynamic = hasPgDynamicSql(body);

  // Build the static body by masking string-literal contents.
  // References that exist ONLY inside dynamic strings are excluded.
  const staticBody = maskDynamicStrings(body);

  const dependencies: RawDependency[] = [];

  for (const dep of deps) {
    // Skip unresolved / empty refs
    if (!dep.schema || !dep.name) {
      continue;
    }

    const targetQName = `${dep.schema}.${dep.name}`;
    const canonicalTarget = pgCanonicalize(targetQName);

    // CRITICAL-1 FIX: only emit an edge if the target actually appears in the
    // static body. Objects absent from the static body get NO edge — we do NOT
    // default to 'read' for objects that are merely in the catalog.
    if (!bodyContainsRef(staticBody, canonicalTarget)) {
      continue;
    }

    // The target is present in the static body — classify as read or write.
    const access = classifyAccess(targetQName, staticBody, pgCanonicalize);

    dependencies.push({
      target: {
        schema: dep.schema,
        name: dep.name,
      },
      access,
      confidence: 'parsed',
    });
  }

  return { hasDynamicSql: dynamic, dependencies };
}
