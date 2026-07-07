/**
 * SQLite body tokenizer seams.
 * Design §"Adapter" / D1–D3 — reuses the engine-agnostic _shared/tokenizer-core.ts
 * primitives (maskDynamicStrings + bodyContainsRef presence-gate + classifyAccess),
 * mirroring pg/tokenizer.ts and mysql/tokenizer.ts.
 *
 * Three PURE functions — no driver imports, no I/O:
 *   - sqliteCanonicalize        : strip [] / "" / backtick identifier quoting → lowercased bare name
 *   - extractTriggerActionBlock : header strip (D2) — mask string literals on a LENGTH-PRESERVING
 *                                 working copy, locate the FIRST \bBEGIN\b + LAST \bEND\b on the
 *                                 MASKED copy, slice the ORIGINAL at those offsets. The whole
 *                                 CREATE TRIGGER … [INSTEAD OF|BEFORE|AFTER] … [UPDATE OF cols]
 *                                 ON <target> [WHEN …] header is DISCARDED so the fires_on object
 *                                 never reaches the tokenizer (L-009 risk #1).
 *   - tokenizeSqliteBody        : maskDynamicStrings → strip comments → bodyContainsRef presence-gate
 *                                 → classifyAccess. Emits ONLY supplied catalog candidates present
 *                                 in the static body, each { target, access, confidence:'parsed' }.
 *
 * SQLite has NO dynamic SQL (no EXECUTE / PREPARE statement form as a routine body), so — unlike
 * pg/mysql — there is NO hasDynamicSql branch; tokenizeSqliteBody returns RawDependency[] directly.
 *
 * Hexagonal ADR-004: imports only from _shared/ and core/model types. ADR-007 (conservative,
 * no grammar parser). ADR-008 (deterministic — regex-only, candidate-ordered emission).
 */

import type { RawDependency } from '../../../core/model/catalog.js';
import { classifyAccess, maskDynamicStrings, bodyContainsRef } from '../_shared/tokenizer-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// sqliteCanonicalize — [] / "" / backtick stripping + lowercase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips SQLite identifier quoting — `[brackets]`, `"double quotes"`, and
 * `` `backticks` `` — from a qualified name and lowercases the result.
 *
 * The double-quote (34) and backtick (96) delimiters are built via String.fromCharCode
 * so no literal quote/backtick chars appear in this source (mirrors pg/mysql — ADR-007/US-031).
 *
 * Examples:
 *   [main].[Departments]  → main.departments
 *   "main"."Employees"    → main.employees
 *   `main`.`Audit_Log`    → main.audit_log
 *   Departments           → departments
 */
export function sqliteCanonicalize(rawName: string): string {
  const dq = String.fromCharCode(34); // 34 = ASCII double-quote
  const bt = String.fromCharCode(96); // 96 = ASCII backtick
  return rawName
    .replace(/\[([^\]]*)\]/g, '$1') // [name] → name
    .replace(new RegExp(`${dq}([^${dq}]*)${dq}`, 'g'), '$1') // "name" → name
    .replace(new RegExp(`${bt}([^${bt}]*)${bt}`, 'g'), '$1') // `name` → name
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// extractTriggerActionBlock — header strip via mask-then-slice (Design D2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Masks single-quoted string-literal CONTENTS with a same-length filler so that the
 * masked copy is BYTE-FOR-BYTE the same length as the input. This is what makes
 * offsets located on the masked copy valid for slicing the ORIGINAL (D2). The shared
 * maskDynamicStrings is NOT used here because it substitutes a fixed-width placeholder
 * and therefore shifts offsets.
 *
 * '' (escaped single quote) inside a literal is consumed by the [^']|'' alternation.
 * The filler is a non-word char so it can never form a spurious \bBEGIN\b / \bEND\b.
 */
function maskStringLiteralsPreservingLength(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, (match) => `'${'-'.repeat(Math.max(0, match.length - 2))}'`);
}

/**
 * Returns the `BEGIN…END` action block of a CREATE TRIGGER statement with the entire
 * header removed, so downstream presence-gating never sees the fires_on `ON <target>`
 * object, the `WHEN` clause, `INSTEAD OF`/`BEFORE`/`AFTER`, or `UPDATE OF <cols>`.
 *
 * Algorithm (D2): build a length-preserving string-masked working copy, locate the FIRST
 * `\bBEGIN\b` and the LAST `\bEND\b` on the MASKED copy (so BEGIN/END tokens inside a
 * WHEN-clause or body string literal cannot mis-slice), then slice the ORIGINAL at those
 * offsets so real identifiers survive for classification.
 *
 * Returns '' when there is no BEGIN…END block (e.g. a single-statement trigger body).
 */
export function extractTriggerActionBlock(triggerSql: string): string {
  const masked = maskStringLiteralsPreservingLength(triggerSql);

  const beginMatch = /\bBEGIN\b/i.exec(masked);
  if (beginMatch === null) return '';
  const startIdx = beginMatch.index;

  const endRe = /\bEND\b/gi;
  let lastEndOffset = -1;
  let m: RegExpExecArray | null;
  while ((m = endRe.exec(masked)) !== null) {
    lastEndOffset = m.index + m[0].length;
  }
  if (lastEndOffset <= startIdx) return '';

  // Offsets are valid on the ORIGINAL because the mask is length-preserving.
  return triggerSql.slice(startIdx, lastEndOffset);
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL comment stripping (SQLite bodies from sqlite_master preserve source comments)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Removes SQL block comments and `-- line` comments from a body whose string literals are
 * ALREADY masked (so a `--` or a block-comment opener inside a string literal is never
 * mistaken for a comment). A table/view name appearing only inside a comment MUST NOT fabricate an
 * edge (spec: "No self-edges and no phantom edges"); SQLite is unlike pg/mysql here
 * because `sqlite_master.sql` retains author comments verbatim.
 */
function stripSqlComments(maskedBody: string): string {
  return maskedBody
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/--[^\n]*/g, ' '); // line comments
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeSqliteBody — presence-gate + classification
// ─────────────────────────────────────────────────────────────────────────────

interface DepRef {
  readonly schema: string;
  readonly name: string;
}

/**
 * Classifies dependency edges from a SQLite view body or trigger ACTION block against a
 * candidate list of catalog objects (tables + views), reusing the shared tokenizer primitives.
 *
 * Behaviour (mirrors pg/mysql, plus SQLite comment stripping):
 *   - Masks single-quoted string-literal contents (maskDynamicStrings) then strips SQL
 *     comments → a "static body". References that exist ONLY inside a string literal or a
 *     comment are excluded.
 *   - Emits an edge ONLY when the candidate canonicalized qname (qualified OR simple name)
 *     actually appears in the static body (bodyContainsRef presence-gate). Objects absent
 *     from the static body get NO edge — we never default to 'read' for a catalog object
 *     that is not referenced.
 *   - Self-edges are excluded by the CALLER omitting the object own qname from `deps`
 *     (SQLite view bodies from sqlite_master include the `CREATE VIEW <name> AS` header).
 *   - Each emitted edge carries confidence:'parsed'. Emission order follows `deps` order
 *     (name-sorted by the caller) → deterministic (ADR-008).
 *
 * @param body  A view body or a header-stripped trigger action block.
 * @param deps  Candidate catalog objects to classify (self already excluded by the caller).
 */
export function tokenizeSqliteBody(
  body: string,
  deps: readonly DepRef[],
): readonly RawDependency[] {
  const staticBody = stripSqlComments(maskDynamicStrings(body));

  const dependencies: RawDependency[] = [];

  for (const dep of deps) {
    if (!dep.schema || !dep.name) continue;

    const targetQName = `${dep.schema}.${dep.name}`;
    const canonicalTarget = sqliteCanonicalize(targetQName);

    // Presence gate: only emit for candidates actually referenced in the static body.
    if (!bodyContainsRef(staticBody, canonicalTarget)) continue;

    const access = classifyAccess(targetQName, staticBody, sqliteCanonicalize);

    dependencies.push({
      target: { schema: dep.schema, name: dep.name },
      access,
      confidence: 'parsed',
    });
  }

  return dependencies;
}
