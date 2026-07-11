/**
 * Benchmark scorer — public barrel + shared helpers + types (US-035, design §Scorer).
 *
 * The scorer is PURE, node-builtins-only, and condition-BLIND (D13): comparators receive
 * ONLY `{ family, answerParsed, groundTruth }` — NEVER the WITH/WITHOUT label. This is the
 * single source of answer normalization (D3): every downstream stage (`generate`,
 * `build-packets`, `score`) imports THESE helpers rather than re-implementing them.
 *
 * Shared helpers (task 1.1): `parseAnswer`, `normalizeQname`, `canonicalType`.
 */

// ── Family taxonomy (D6 — closed-form families, NO free-text/rubric member) ──────
// The six original lookup families PLUS the three v2 task-planning families (D4). All are
// CLOSED-FORM (deterministic scoring); v2 adds NO rubric/free-text member — plan-callers /
// plan-blindspots reuse the unordered set-match rule, plan-order the new topo-order rule.
export type Family =
  | 'fk-path'
  | 'column-type'
  | 'impact'
  | 'trigger-inventory'
  | 'view-dependency'
  | 'constraint-semantics'
  | 'plan-callers'
  | 'plan-blindspots'
  | 'plan-order';

/**
 * Runtime tuple of the closed-form families in canonical order: the six lookup families FOLLOWED
 * by the three v2 task-planning families (D4). Headline accuracy stays 100% closed-form — every
 * member is deterministically scored, there is still NO free-text/rubric family. `score.ts`
 * iterates this tuple and FILTERS families with zero questions, so a frozen sqlite run (which has
 * no plan-* questions) produces a byte-identical aggregate even though the tuple grew (D6).
 */
export const FAMILIES: readonly Family[] = [
  'fk-path',
  'column-type',
  'impact',
  'trigger-inventory',
  'view-dependency',
  'constraint-semantics',
  'plan-callers',
  'plan-blindspots',
  'plan-order',
] as const;

// ── Ground-truth shapes, keyed by family (mechanical derivation output, D5) ──────
export interface FkJoinColumn {
  readonly fromColumn: string;
  readonly toColumn: string;
}

export interface FkHop {
  readonly fromTable: string;
  readonly toTable: string;
  readonly joinColumns: readonly FkJoinColumn[];
}

export interface TriggerTuple {
  readonly triggerQname: string;
  readonly timing: string;
  readonly events: readonly string[];
}

/** Per-family ground-truth key shape. `scoreAnswer` narrows on `family`. */
export interface GroundTruthByFamily {
  'fk-path': { readonly hops: readonly FkHop[] };
  'column-type': { readonly dataType: string; readonly nullable: boolean };
  impact: { readonly whatToTest: readonly string[] };
  'trigger-inventory': { readonly triggers: readonly TriggerTuple[] };
  'view-dependency': { readonly dependencies: readonly string[] };
  'constraint-semantics': { readonly columns: readonly string[]; readonly ordered: boolean };
  // v2 planning families (D3/D4). The committed key FILES also carry `source_ddl_ref` +
  // `source_ddl_refs` (auditable pointers) — those are ignored by the scorer, which reads
  // only the scored fields below.
  'plan-callers': { readonly callers: readonly string[] };
  'plan-blindspots': { readonly blind_spots: readonly string[]; readonly scope: readonly string[] };
  'plan-order': {
    readonly scope: readonly string[];
    readonly precede: readonly (readonly [string, string])[];
  };
}

export interface ScoreResult {
  readonly correct: boolean;
  readonly expected: string;
  readonly got: string;
  readonly detail: string;
}

/**
 * The scorer input is a discriminated union on `family`. It carries NO `condition`
 * (WITH/WITHOUT) field — blindness is enforced at the TYPE level (D13).
 */
export type ScoreInput = {
  [F in Family]: {
    readonly family: F;
    readonly answerParsed: string;
    readonly groundTruth: GroundTruthByFamily[F];
  };
}[Family];

// ── Shared helpers (task 1.1) — pure string normalization ────────────────────

/**
 * Extract the value after the FINAL `ANSWER:` line (design D12). Returns the trimmed
 * value, or an empty string when no well-formed `ANSWER:` line is present.
 */
export function parseAnswer(raw: string): string {
  const lines = raw.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^\s*ANSWER:\s*(.*)$/.exec(lines[i] ?? '');
    if (match) return (match[1] ?? '').trim();
  }
  return '';
}

/**
 * Canonicalize a qualified name: strip quotes/backticks/brackets, lowercase, and
 * collapse internal whitespace. Makes qname comparisons dialect-quoting-independent.
 */
export function normalizeQname(s: string): string {
  return s
    .replace(/[`"[\]]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// INT↔INTEGER is the pinned synonym pair (task 1.1); both canonicalize to INTEGER.
const TYPE_SYNONYMS: Readonly<Record<string, string>> = {
  INT: 'INTEGER',
  INTEGER: 'INTEGER',
};

/**
 * Canonicalize a declared column type: uppercase, trim, collapse whitespace, and apply
 * the INT↔INTEGER synonym table so `int` and `integer` score equal.
 */
export function canonicalType(s: string): string {
  const upper = s.replace(/\s+/g, ' ').trim().toUpperCase();
  return TYPE_SYNONYMS[upper] ?? upper;
}

// ── Public re-exports: one pure comparator per family (design §Scorer, D6) ───
export {
  compareFkPath,
  compareColumnType,
  compareImpact,
  compareTriggerInventory,
  compareViewDependency,
  compareConstraintSemantics,
  comparePlanCallers,
  comparePlanBlindspots,
  comparePlanOrder,
} from './families.ts';

// ── Public re-exports: token-accounting formula (design §Token accounting, D9) ──
export { schemaTokens } from './tokens.ts';
export type { TokenCount, TokenMode, SchemaTokenInput } from './tokens.ts';

// ── Blind dispatcher (task 1.7, D13) ─────────────────────────────────────────
import {
  compareFkPath,
  compareColumnType,
  compareImpact,
  compareTriggerInventory,
  compareViewDependency,
  compareConstraintSemantics,
  comparePlanCallers,
  comparePlanBlindspots,
  comparePlanOrder,
} from './families.ts';

/**
 * Score one answer against its ground-truth key. The input carries NO condition label
 * (D13 — blindness enforced at the type level), and scoring is deterministic: the same
 * input always yields byte-identical output (ADR-008). Throws on an unknown family — there
 * is NO rubric/free-text/fallback scoring path (D6).
 */
export function scoreAnswer(input: ScoreInput): ScoreResult {
  if (!FAMILIES.includes(input.family)) {
    throw new Error(`Unknown benchmark family: ${String(input.family)}`);
  }
  switch (input.family) {
    case 'fk-path':
      return compareFkPath(input.answerParsed, input.groundTruth);
    case 'column-type':
      return compareColumnType(input.answerParsed, input.groundTruth);
    case 'impact':
      return compareImpact(input.answerParsed, input.groundTruth);
    case 'trigger-inventory':
      return compareTriggerInventory(input.answerParsed, input.groundTruth);
    case 'view-dependency':
      return compareViewDependency(input.answerParsed, input.groundTruth);
    case 'constraint-semantics':
      return compareConstraintSemantics(input.answerParsed, input.groundTruth);
    case 'plan-callers':
      return comparePlanCallers(input.answerParsed, input.groundTruth);
    case 'plan-blindspots':
      return comparePlanBlindspots(input.answerParsed, input.groundTruth);
    case 'plan-order':
      return comparePlanOrder(input.answerParsed, input.groundTruth);
    default: {
      // Exhaustiveness guard — unreachable given the FAMILIES check above.
      throw new Error(`Unknown benchmark family: ${String((input as { family: string }).family)}`);
    }
  }
}
