/**
 * `harness-checks.ts` — PURE, I/O-free harness decisions (benchmark-harness-hardening,
 * design Decision 1). No `fs`/`crypto`/`Database`; the dev stages keep their I/O and CALL
 * these helpers, while the vitest units import THIS module directly.
 *
 * The independence guard (`test/benchmark/independence.test.ts`,
 * `STAGE_RE = /benchmark[\\/](?:generate|build-packets|score|render)\.(?:ts|js)/`) forbids a
 * vitest suite from importing a dev-stage entrypoint. This module's name matches NONE of the
 * four stage names, so a unit MAY import it — that is precisely why the seam exists: unit
 * coverage of stage-abort/stamp decisions with zero coupling to a benchmark run.
 *
 * Three exports:
 *   - `deriveCoverageTargets` — the schema objects a question's answer depends on (D2/D2-shape).
 *   - `verifyDumpCoverage`    — the targets NOT DEFINED in a DDL dump (D3).
 *   - `joinManifestHashes`    — raw run hashes joined to the authoritative manifest hashes (D4/OQ1).
 */

import type { Family } from './scorer/index.ts';

// ── No-answer-leak overlap (Gap 1 / D5) ──────────────────────────────────────

/** Alphanumeric-adjacency flank: an occurrence touching one of these is NOT standalone. */
const LEAK_FLANK_RE = /[a-z0-9_]/;

/**
 * True iff `needle` occurs in `haystack` as a STANDALONE token — an occurrence NOT flanked, on
 * either side, by an alphanumeric-or-underscore character (`[a-z0-9_]`). This is the project's
 * alphanumeric-adjacency convention, deliberately NOT a `\b` regex: the needle is matched as a
 * LITERAL string via `indexOf`, so answer tokens holding punctuation (dots, commas, parens — e.g.
 * a composed FK path) are compared verbatim and never treated as a pattern. Every occurrence is
 * scanned: a token embedded in one place AND free-standing in another still leaks. Case-insensitive
 * (lowercases both sides; idempotent when the caller already lowercased).
 */
export function occursStandalone(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  for (let from = 0; ; ) {
    const at = h.indexOf(n, from);
    if (at === -1) return false;
    const before = at > 0 ? h[at - 1]! : '';
    const after = at + n.length < h.length ? h[at + n.length]! : '';
    if (!LEAK_FLANK_RE.test(before) && !LEAK_FLANK_RE.test(after)) return true;
    from = at + 1; // keep scanning; overlapping/repeat occurrences allowed
  }
}

// ── Scope-block exclusion (r2) — shared by BOTH leak/pair guards ─────────────

/** The literal own-line markers that delimit a served scope list (r2, uppercase). */
const SCOPE_BEGIN = '=== SCOPE BEGIN ===';
const SCOPE_END = '=== SCOPE END ===';
const SCOPE_BEGIN_RE = /^[ \t]*=== SCOPE BEGIN ===[ \t]*$/m;
const SCOPE_END_RE = /^[ \t]*=== SCOPE END ===[ \t]*$/m;

/**
 * Return `text` with the marked SCOPE region removed — the ONE shared exclusion used by BOTH
 * `generate`'s `assertNoAnswerLeak` and `build-packets`'s `assertPacketPair` (r2 — never two
 * hand-copied patterns). For scope-list planning families the served scope block is FAIR input
 * (the agent must read it), so its content must NOT count as an answer leak; this strips it
 * BEFORE the leak scan. The scope list is delimited by the literal own-line markers
 * `=== SCOPE BEGIN ===` / `=== SCOPE END ===` (both dropped, plus everything between).
 *
 * When NEITHER marker is present the input is returned BYTE-IDENTICAL (the sqlite path has no
 * scope block, so this is a no-op). An UNBALANCED (BEGIN without END, or END without BEGIN) or
 * NESTED (a second BEGIN before its END) marker set aborts LOUDLY — a malformed scope block must
 * never silently pass the guard.
 */
export function excludeScopeBlock(text: string): string {
  const hasBegin = SCOPE_BEGIN_RE.test(text);
  const hasEnd = SCOPE_END_RE.test(text);
  if (!hasBegin && !hasEnd) return text; // no markers → unchanged (byte-identical sqlite path)
  if (hasBegin !== hasEnd) {
    throw new Error(
      `excludeScopeBlock: unbalanced scope markers (BEGIN=${hasBegin}, END=${hasEnd}) — a scope block MUST carry BOTH "${SCOPE_BEGIN}" and "${SCOPE_END}" on their own lines.`,
    );
  }
  const out: string[] = [];
  let inScope = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === SCOPE_BEGIN) {
      if (inScope) {
        throw new Error('excludeScopeBlock: nested "=== SCOPE BEGIN ===" before a matching END — scope markers must NOT nest.');
      }
      inScope = true;
      continue; // drop the BEGIN marker line
    }
    if (trimmed === SCOPE_END) {
      inScope = false;
      continue; // drop the END marker line
    }
    if (!inScope) out.push(line);
  }
  if (inScope) {
    throw new Error('excludeScopeBlock: "=== SCOPE BEGIN ===" without a matching "=== SCOPE END ===" — the scope block is unterminated.');
  }
  return out.join('\n');
}

/**
 * Assemble a served scope list into the marked block (B2) — the inverse of `excludeScopeBlock`.
 * The scope-list planning families (`plan-blindspots`, `plan-order`) serve this block IDENTICALLY
 * to both conditions; `generate` appends it to the question prose, and BOTH leak guards strip it
 * via `excludeScopeBlock` so the fair scope input never counts as an answer leak.
 */
export function buildScopeBlock(scope: readonly string[]): string {
  return [SCOPE_BEGIN, ...scope, SCOPE_END].join('\n');
}

// ── Substrate dimension (B1 / D4) ────────────────────────────────────────────

/**
 * The pre-registered N bound for a substrate (r3). Lookup sets (`sqlite-torture` and any other
 * substrate) keep the frozen 5..10 bound; the `mssql-torture` PLANNING substrate relaxes the lower
 * bound to 3 (v2 ships N=3). The bound's INTENT is anti-cherry-picking — every committed question
 * in a pre-registered set MUST run, none dropped — enforced by the caller.
 */
export function nBoundsForSubstrate(substrate: string): { readonly min: number; readonly max: number } {
  return substrate === 'mssql-torture' ? { min: 3, max: 10 } : { min: 5, max: 10 };
}

/**
 * Optional substrate caption for `render` (B1). ABSENT (or empty) ⇒ an EMPTY string so the default
 * render output is BYTE-IDENTICAL; a given substrate prepends a labeled caption so every v2 table
 * carries its substrate label (spec Req 4).
 */
export function substrateCaption(substrate?: string): string {
  if (substrate === undefined || substrate.length === 0) return '';
  return `Substrate: ${substrate}\n\n`;
}

/**
 * The deterministic mssql WITHOUT dump (D5): the committed `test/fixtures/mssql/torture.sql`
 * stripped of every full-line `--` comment (which removes the header block), and every `GO` batch
 * separator — KEEPING every CREATE statement and full SP body VERBATIM (the whole SP story:
 * `sp_executesql`, EXEC call chains, composite FKs). Runs of blank lines collapse to one and
 * leading/trailing blank lines are trimmed, so the output is byte-stable. This is a faithful,
 * Docker-free, deterministic catalog dump (the applied fixture is byte-identical to what
 * `sys.sql_modules.definition` would return), fair WITHOUT input the agent must read and reason over.
 */
export function stripMssqlDdl(rawSql: string): string {
  const kept: string[] = [];
  for (const line of rawSql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue; // full-line comment (incl. the header block)
    if (/^GO$/i.test(trimmed)) continue; // batch separator
    kept.push(line);
  }
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of kept) {
    const blank = line.trim().length === 0;
    if (blank && prevBlank) continue; // collapse runs of blank lines
    collapsed.push(line);
    prevBlank = blank;
  }
  while (collapsed.length > 0 && collapsed[0]!.trim() === '') collapsed.shift();
  while (collapsed.length > 0 && collapsed[collapsed.length - 1]!.trim() === '') collapsed.pop();
  return `${collapsed.join('\n')}\n`;
}

// ── Coverage targets (D2) ────────────────────────────────────────────────────

export type ObjectKind = 'table' | 'view' | 'trigger' | 'any'; // 'any' = kind-agnostic (name-only)

export interface CoverageTarget {
  readonly kind: ObjectKind;
  readonly name: string;
}

/** Minimal typed views of the committed ground-truth shapes this module reads. */
interface HopShape {
  readonly fromTable: string;
  readonly toTable: string;
}
interface TriggerShape {
  readonly triggerQname: string;
}

/**
 * Derive the schema objects a question's answer depends on — pure, from the qid + typed GT
 * ONLY (never `source_ddl_ref`, never the composed answer atom — that would be the LEAK).
 *
 * The qid tail is parsed by anchoring on the KNOWN family (`qid.slice(family.length + 1)`),
 * robust to hyphens in either the family name or the encoded table.
 */
export function deriveCoverageTargets(
  qid: string,
  family: Family,
  gt: Record<string, unknown>,
): readonly CoverageTarget[] {
  switch (family) {
    case 'fk-path': {
      const hops = (gt['hops'] ?? []) as readonly HopShape[];
      const out: CoverageTarget[] = [];
      for (const hop of hops) {
        out.push({ kind: 'table', name: hop.fromTable });
        out.push({ kind: 'table', name: hop.toTable });
      }
      return out;
    }
    case 'trigger-inventory': {
      const triggers = (gt['triggers'] ?? []) as readonly TriggerShape[];
      return triggers.map((t) => ({ kind: 'trigger', name: t.triggerQname }));
    }
    case 'impact': {
      // Committed shape: whatToTest is a FLAT array of bare object-name strings (D2-shape).
      // `affected` may name a table, VIEW, or TRIGGER, so match by NAME only, KIND-AGNOSTIC
      // (`kind:'any'`) — a name-only match cannot false-pass (names are unique per schema),
      // yet a name absent from a wrong-DB dump still MISSES (see verifyDumpCoverage / Gap 2).
      const names = (gt['whatToTest'] ?? []) as readonly string[];
      return names.map((name) => ({ kind: 'any', name }));
    }
    case 'column-type':
    case 'constraint-semantics': {
      const table = tableFromQid(qid, family);
      return [{ kind: 'table', name: table }];
    }
    case 'view-dependency': {
      // Inert for the frozen 5-question set (no committed view-dependency question). Derive
      // ONLY the view from the qid if this branch is ever exercised; dependencies[] are NOT
      // targets (OQ2).
      const view = tableFromQid(qid, family);
      return [{ kind: 'view', name: view }];
    }
    case 'plan-callers': {
      // v2 (spec Req 5 / r4): every planted CALLER routine must be DEFINED in the dump. A caller
      // may be a proc or function, so match by NAME only (kind:'any'). The callee (the routine
      // whose signature changes) is the question SUBJECT, not a coverage target.
      const callers = (gt['callers'] ?? []) as readonly string[];
      return callers.map((name) => ({ kind: 'any', name }));
    }
    case 'plan-blindspots': {
      // v2: cover each BLIND-SPOT routine (the scored answer subset) — NOT the served scope list,
      // which is fair prompt input, not an answer target. Name-only (kind:'any').
      const blindSpots = (gt['blind_spots'] ?? []) as readonly string[];
      return blindSpots.map((name) => ({ kind: 'any', name }));
    }
    case 'plan-order': {
      // v2 (r4): kind-agnostic over the FULL scoped object set (tables + routines). Every scoped
      // object of the drop/recreate ordering must be DEFINED in the dump; name-only (kind:'any').
      const scope = (gt['scope'] ?? []) as readonly string[];
      return scope.map((name) => ({ kind: 'any', name }));
    }
    default:
      return [];
  }
}

/** The identifier encoded in the qid tail, before the first `.` (drops a `.column` suffix). */
function tableFromQid(qid: string, family: Family): string {
  const tail = qid.slice(family.length + 1);
  return tail.split('.')[0] ?? tail;
}

// ── Dump coverage (D3) ───────────────────────────────────────────────────────

// One CREATE-defined object per match: kind + raw name token (schema/quotes stripped later).
// Tolerates `TEMP`/`TEMPORARY` and `IF NOT EXISTS`. The name token stops at whitespace, `(`
// or `;` — enough for the deterministic `sqlite_master` dump and the unit mini-dumps.
// PROCEDURE|PROC|FUNCTION are included (r4 / D2c) so mssql routines register as DEFINED; without
// them the plan-* coverage assert on the live substrate always fails. PROCEDURE precedes PROC in
// the alternation so `CREATE PROCEDURE` matches the full keyword, never a truncated `PROC`.
const CREATE_OBJECT_RE =
  /CREATE\s+(?:TEMP(?:ORARY)?\s+)?(PROCEDURE|PROC|FUNCTION|TABLE|VIEW|TRIGGER|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(;]+)/gi;

/** Normalize an object identifier: strip quoting + optional `schema.` prefix, lowercase. */
function normalizeObjectName(raw: string): string {
  const unquoted = raw.replace(/[`"[\]]/g, '');
  const segments = unquoted.split('.');
  const last = segments[segments.length - 1] ?? unquoted;
  return last.toLowerCase();
}

/**
 * Return the targets NOT DEFINED in the dump (empty ⇒ full coverage). A CONCRETE-kind target is
 * covered iff its `kind:name` appears in the set of `CREATE (TABLE|VIEW|TRIGGER|INDEX)` statements
 * — a bare `REFERENCES x` or a column named like the target does NOT cover it (D3). A KIND-AGNOSTIC
 * target (`kind:'any'`, emitted for impact whatToTest) is covered iff its NAME is defined under ANY
 * kind — because `affected` may name a table/view/trigger, and object names are unique per schema, a
 * name-only match cannot false-pass on the correct substrate yet still misses a wrong-DB dump (Gap 2).
 * Pure.
 */
export function verifyDumpCoverage(
  ddlDump: string,
  targets: readonly CoverageTarget[],
): readonly CoverageTarget[] {
  const defined = new Set<string>();
  const definedNames = new Set<string>();
  for (const match of ddlDump.matchAll(CREATE_OBJECT_RE)) {
    const kind = (match[1] ?? '').toLowerCase();
    const name = normalizeObjectName(match[2] ?? '');
    if (name.length > 0) {
      defined.add(`${kind}:${name}`);
      definedNames.add(name);
    }
  }
  return targets.filter((t) => {
    const name = normalizeObjectName(t.name);
    return t.kind === 'any'
      ? !definedNames.has(name) // kind-agnostic: name present under ANY kind
      : !defined.has(`${t.kind}:${name}`); // concrete kind: exact kind:name (UNCHANGED)
  });
}

// ── Planting-key DDL audit (v2, A5 — spec Req 1) ─────────────────────────────

/** Verdict for one planted target: is its fact PRESENT at its cited DDL span? */
export interface PlanKeyAuditResult {
  readonly qid: string;
  readonly family: string;
  readonly target: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** A committed dynamic-SQL construct proves a plan-blindspots target's hidden dependency. */
const DYNAMIC_SQL_RE = /sp_executesql|exec\s*\(/i;

/** Extract the inclusive line span cited by a `path:START[-END]` ref; null when unparseable/OOB. */
function extractDdlSpan(ddlText: string, ref: string): string | null {
  const m = /:(\d+)(?:-(\d+))?\s*$/.exec(ref);
  if (m === null) return null;
  const start = Number.parseInt(m[1] ?? '', 10);
  const end = m[2] !== undefined ? Number.parseInt(m[2], 10) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  const lines = ddlText.split(/\r?\n/);
  if (end > lines.length) return null;
  return lines.slice(start - 1, end).join('\n');
}

/** Case-insensitive literal-substring presence (targets carry `_`/`->`, never a regex pattern). */
function spanContains(span: string, token: string): boolean {
  return token.length > 0 && span.toLowerCase().includes(token.toLowerCase());
}

/**
 * Audit every planted target of a committed plan-* key against the DDL text — PURE (the caller
 * reads `torture.sql`). Each target's `source_ddl_ref` cited span MUST contain the planted fact,
 * greppable-auditable (spec Req 1):
 *   - plan-callers: the caller AND the callee both appear in the span (the EXEC is the call fact);
 *   - plan-blindspots: the blind-spot routine appears AND the span carries a dynamic-SQL construct
 *     (`sp_executesql`/`EXEC(...)`) — the reference invisible to static edges;
 *   - plan-order: BOTH endpoints of the must-precede pair appear in the span (the FK/call fact).
 * A missing ref entry, an unparseable/out-of-bounds span, or an absent fact yields `ok:false` with
 * a detail naming the qid + target — an unverifiable hand-planted key is a SPEC VIOLATION, never a
 * silent pass.
 */
export function auditPlanKey(
  key: Record<string, unknown>,
  ddlText: string,
): readonly PlanKeyAuditResult[] {
  const qid = String(key['qid'] ?? '<unknown-qid>');
  const family = String(key['family'] ?? '<unknown-family>');
  const refs = (key['source_ddl_refs'] ?? {}) as Record<string, string>;

  // (target, refKey, requiredTokens, requireDynamicSql) per family.
  const checks: { target: string; refKey: string; tokens: string[]; requireDynamic: boolean }[] = [];
  if (family === 'plan-callers') {
    const callee = String(key['callee'] ?? '');
    for (const caller of (key['callers'] ?? []) as readonly string[]) {
      checks.push({ target: caller, refKey: caller, tokens: [caller, callee], requireDynamic: false });
    }
  } else if (family === 'plan-blindspots') {
    for (const bs of (key['blind_spots'] ?? []) as readonly string[]) {
      checks.push({ target: bs, refKey: bs, tokens: [bs], requireDynamic: true });
    }
  } else if (family === 'plan-order') {
    for (const pair of (key['precede'] ?? []) as readonly (readonly [string, string])[]) {
      const [u, v] = pair;
      const target = `${u}->${v}`;
      checks.push({ target, refKey: target, tokens: [u, v], requireDynamic: false });
    }
  }

  return checks.map(({ target, refKey, tokens, requireDynamic }) => {
    const ref = refs[refKey];
    if (ref === undefined || ref.length === 0) {
      return { qid, family, target, ok: false, detail: `${qid} / ${target}: no source_ddl_ref entry — a planted target MUST cite its DDL span (Req 1).` };
    }
    const span = extractDdlSpan(ddlText, ref);
    if (span === null) {
      return { qid, family, target, ok: false, detail: `${qid} / ${target}: source_ddl_ref "${ref}" is unparseable or out of bounds.` };
    }
    const missing = tokens.filter((t) => !spanContains(span, t));
    if (missing.length > 0) {
      return { qid, family, target, ok: false, detail: `${qid} / ${target}: cited span ${ref} does NOT contain ${missing.map((t) => `"${t}"`).join(', ')} — planted fact absent (SPEC VIOLATION).` };
    }
    if (requireDynamic && !DYNAMIC_SQL_RE.test(span)) {
      return { qid, family, target, ok: false, detail: `${qid} / ${target}: cited span ${ref} carries NO dynamic-SQL construct — the blind-spot fact is absent (SPEC VIOLATION).` };
    }
    return { qid, family, target, ok: true, detail: `${qid} / ${target}: fact present at ${ref}.` };
  });
}

// ── Manifest hash join (D4 / OQ1) ────────────────────────────────────────────

export interface ManifestHashEntry {
  readonly qid: string;
  readonly condition: 'with' | 'without';
  readonly promptSha256: string;
}

export interface RawHashRef {
  readonly qid: string;
  readonly condition: 'with' | 'without';
  readonly promptSha256?: string;
}

export type HashJoinStatus = 'ok' | 'mismatch' | 'empty-raw' | 'missing-in-manifest';

export interface HashJoinResult {
  readonly qid: string;
  readonly condition: 'with' | 'without';
  /** From the manifest; `null` when the (qid,condition) is absent from the manifest. */
  readonly authoritativePromptSha256: string | null;
  /** `''` when the raw record's hash is empty/absent. */
  readonly rawPromptSha256: string;
  readonly status: HashJoinStatus;
}

/**
 * Join raw run hashes to the authoritative manifest hashes — pure, NO throw; the caller decides
 * severity. Precedence: absent-from-manifest (`missing-in-manifest`) first (cannot stamp), then
 * empty raw (`empty-raw`), then equality (`ok`) vs disagreement (`mismatch`). Results carry ONLY
 * qid / condition / hashes / status — never a CoverageTarget or answer VALUE (leak guard).
 */
export function joinManifestHashes(
  manifest: readonly ManifestHashEntry[],
  raw: readonly RawHashRef[],
): readonly HashJoinResult[] {
  const authoritativeByKey = new Map<string, string>();
  for (const entry of manifest) {
    authoritativeByKey.set(`${entry.qid} ${entry.condition}`, entry.promptSha256);
  }
  return raw.map((ref) => {
    const authoritative = authoritativeByKey.get(`${ref.qid} ${ref.condition}`);
    const rawPromptSha256 = ref.promptSha256 ?? '';
    if (authoritative === undefined) {
      return {
        qid: ref.qid,
        condition: ref.condition,
        authoritativePromptSha256: null,
        rawPromptSha256,
        status: 'missing-in-manifest',
      };
    }
    if (rawPromptSha256 === '') {
      return {
        qid: ref.qid,
        condition: ref.condition,
        authoritativePromptSha256: authoritative,
        rawPromptSha256: '',
        status: 'empty-raw',
      };
    }
    return {
      qid: ref.qid,
      condition: ref.condition,
      authoritativePromptSha256: authoritative,
      rawPromptSha256,
      status: rawPromptSha256 === authoritative ? 'ok' : 'mismatch',
    };
  });
}
