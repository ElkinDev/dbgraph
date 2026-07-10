/**
 * MySQL body tokenizer.
 * Design §tokenizer.ts — hasMysqlDynamicSql, mysqlCanonicalize, tokenizeMysqlBody.
 *
 * MySQL hasDynamicSql = body contains PREPARE or EXECUTE (bare word boundaries).
 * MySQL trigger DDL has NO "EXECUTE FUNCTION" clause (unlike PG), so NO strip step needed.
 *
 * mysqlCanonicalize: strips BACKTICK delimiters (MySQL identifier quoting) and
 * (defensively) double-quotes, then lowercases.
 * Backtick char is built via String.fromCharCode(96) to keep source scanner-clean
 * (mirrors pg's String.fromCharCode(34) double-quote trick — ADR-007/US-031).
 *
 * tokenizeMysqlBody wires the _shared/ primitives with mysqlCanonicalize:
 *   1. hasMysqlDynamicSql on ORIGINAL body.
 *   2. maskDynamicStrings → staticBody (removes single-quoted string literal contents).
 *   3. For each dep: bodyContainsRef(staticBody, canon(qname)) as PRESENCE GATE.
 *   4. classifyAccess(qname, staticBody, mysqlCanonicalize) → read | write.
 *   5. Push { target, access, confidence:'parsed' }.
 * Static edges survive when hasDynamicSql is true (only dynamic-string refs excluded).
 * Self-edges are naturally excluded by the presence gate.
 *
 * All dependency edges carry confidence: 'parsed' (no score).
 * supportsDependencyHints: false — body tokenizer is the SOLE edge source.
 *
 * US-029 (MySQL adapter, Phase 8b), US-007 (hasDynamicSql declared blindness),
 * ADR-007 (conservative tokenizer), CRITICAL-1 (presence gate — no phantom edges).
 */

import type { RawDependency } from '../../../core/model/catalog.js';
import { classifyAccess, maskDynamicStrings, bodyContainsRef } from '../_shared/tokenizer-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// mysqlCanonicalize — backtick + double-quote stripping + lowercase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips backtick delimiters and (defensively) double-quote delimiters
 * in a qualified name and lowercases the result.
 *
 * MySQL uses backtick quoting for identifiers; double-quotes require ANSI_QUOTES mode.
 * The backtick char (96) and double-quote char (34) are built via String.fromCharCode
 * to keep the source free of literal special chars that would confuse the write-verb
 * scanner (ADR-007, US-031).
 *
 * Examples:
 *   `app`.`orders`  → app.orders
 *   `Orders`        → orders
 *   orders          → orders
 *   "app"."orders"  → app.orders (defensive — ANSI_QUOTES mode)
 */
export function mysqlCanonicalize(rawName: string): string {
  // Build delimiter chars without literal chars in source
  const bt = String.fromCharCode(96);  // 96 = ASCII backtick
  const dq = String.fromCharCode(34);  // 34 = ASCII double-quote
  return rawName
    .replace(new RegExp(`${bt}([^${bt}]*)${bt}`, 'g'), '$1') // backtick-delimited → unquoted
    .replace(new RegExp(`${dq}([^${dq}]*)${dq}`, 'g'), '$1') // dquote-delimited → unquoted (defensive)
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// hasMysqlDynamicSql — PREPARE/EXECUTE detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the body contains a MySQL dynamic SQL statement:
 * PREPARE or EXECUTE (word boundary matched, case-insensitive).
 *
 * MySQL dynamic SQL = PREPARE stmt (FROM a variable or expression);
 *                     EXECUTE stmt; DEALLOCATE PREPARE stmt.
 *
 * Unlike PostgreSQL, MySQL trigger DDL has NO "EXECUTE FUNCTION fn()" clause,
 * so NO stripping step is needed here — simpler than pg (D8).
 *
 * Detection on the ORIGINAL (unmasked) body so PREPARE/EXECUTE inside string
 * literals is still detected (conservative — if in doubt, flag it).
 *
 * US-007 (declared blindness — flag and stop, never guess).
 * Pinned by spec: PREPARE/EXECUTE → true; plain static SQL → false.
 */
export function hasMysqlDynamicSql(body: string): boolean {
  return /\b(prepare|execute)\b/i.test(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeMysqlBody — dependency classification
// ─────────────────────────────────────────────────────────────────────────────

interface DepRef {
  readonly schema: string;
  readonly name: string;
  /**
   * DOG-1 (D3/D4): a ROUTINE candidate carries its NodeKind so the presence-gated edge
   * becomes a `calls` edge in the normalizer instead of a read/write. Tables/views leave
   * this unset and keep the existing read/write classification byte-for-byte.
   */
  readonly kind?: 'procedure' | 'function';
}

export interface MysqlTokenizerResult {
  readonly hasDynamicSql: boolean;
  readonly dependencies: readonly RawDependency[];
}

/**
 * Tokenizes a MySQL function/procedure/view body and classifies dependency
 * edges as read or write via the shared tokenizer primitives.
 *
 * Key behaviors (CRITICAL-1 remediation designed-in from the start):
 *   - Builds a "static body" by masking single-quoted string-literal contents
 *     (maskDynamicStrings from _shared/).
 *   - Only emits an edge for a candidate if its canonicalized qname (qualified OR
 *     simple name) actually appears in the STATIC body (presence gate via bodyContainsRef
 *     from _shared/). Objects absent from the static body get NO edge — we NEVER
 *     default to 'read' for absent objects.
 *   - hasDynamicSql is detected from the ORIGINAL (unmasked) body.
 *   - Static edges SURVIVE even when hasDynamicSql is true. Only dynamic-string refs
 *     are excluded (a table named ONLY in the prepared string literal gets NO edge).
 *   - All edges carry confidence: 'parsed' (no score field).
 *   - Self-edges are naturally impossible via the presence gate (a routine body never
 *     references its own schema.name as a target in the static portion).
 *
 * @param body  The full routine/view definition body (from ROUTINE_DEFINITION/VIEW_DEFINITION).
 * @param deps  Array of known dependency objects to classify.
 */
export function tokenizeMysqlBody(body: string, deps: readonly DepRef[]): MysqlTokenizerResult {
  // 1. Detect dynamic SQL from the original (unmasked) body.
  const dynamic = hasMysqlDynamicSql(body);

  // 2. Build the static body by masking single-quoted string-literal contents.
  //    References that exist ONLY inside dynamic strings are excluded.
  const staticBody = maskDynamicStrings(body);

  const dependencies: RawDependency[] = [];

  for (const dep of deps) {
    // Skip unresolved / empty refs
    if (!dep.schema || !dep.name) {
      continue;
    }

    const targetQName = `${dep.schema}.${dep.name}`;
    const canonicalTarget = mysqlCanonicalize(targetQName);

    // 3. PRESENCE GATE (CRITICAL-1 fix): only emit an edge if the target actually
    //    appears in the static body. Objects absent from the static body get NO edge.
    //    We do NOT default to 'read' for objects that are merely in the catalog.
    if (!bodyContainsRef(staticBody, canonicalTarget)) {
      continue;
    }

    // 4. The target is present in the static body — classify as read or write.
    const access = classifyAccess(targetQName, staticBody, mysqlCanonicalize);

    dependencies.push({
      target: {
        schema: dep.schema,
        name: dep.name,
        // DOG-1: carry the routine kind through to target.kind (load-bearing in normalize).
        // Non-routine candidates leave kind unset (exactOptionalPropertyTypes-safe spread).
        ...(dep.kind !== undefined ? { kind: dep.kind } : {}),
      },
      access,
      confidence: 'parsed',
    });
  }

  return { hasDynamicSql: dynamic, dependencies };
}
