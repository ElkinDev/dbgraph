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
const CREATE_OBJECT_RE =
  /CREATE\s+(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|TRIGGER|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(;]+)/gi;

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
