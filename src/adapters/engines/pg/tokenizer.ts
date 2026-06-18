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
  return rawName
    .replace(/"([^"]*)"/g, '$1')  // strip dquotes → dquote.name becomes name
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
 * - Uses pgCanonicalize (double-quote only, no brackets) as the dialect canonicalizer.
 * - Skips deps where schema or name is empty (null/unresolved refs).
 * - Returns hasDynamicSql: true when a bare EXECUTE statement is found.
 * - All edges carry confidence: 'parsed' (no score field).
 *
 * @param body  The full routine/view definition body (from pg_get_functiondef/pg_get_viewdef).
 * @param deps  Array of known dependency objects to classify.
 */
export function tokenizePgBody(body: string, deps: readonly DepRef[]): PgTokenizerResult {
  const dynamic = hasPgDynamicSql(body);

  const dependencies: RawDependency[] = [];

  for (const dep of deps) {
    // Skip unresolved / empty refs
    if (!dep.schema || !dep.name) {
      continue;
    }

    const targetQName = `${dep.schema}.${dep.name}`;
    const access = classifyAccess(targetQName, body, pgCanonicalize);

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
