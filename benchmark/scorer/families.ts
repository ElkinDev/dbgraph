/**
 * Per-family comparators (US-035, design §Scorer D6). One PURE comparator per closed-form
 * family. All comparators are condition-BLIND (D13): they receive only the parsed answer and
 * the ground-truth key — never the WITH/WITHOUT label. Scoring rules are PINNED (no partial
 * credit, no fuzzy matching): unordered SET equality everywhere except `column-type` (exact
 * `TYPE|NULLABLE`) and `constraint-semantics` PK (order-SENSITIVE).
 */

import {
  canonicalType,
  normalizeQname,
  type GroundTruthByFamily,
  type ScoreResult,
} from './index.ts';

// ── Small pure set helpers ───────────────────────────────────────────────────

function setEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function displaySet(values: ReadonlySet<string>): string {
  return [...values].sort().join(', ');
}

/** Split a comma-separated answer list into trimmed, non-empty items. */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toQnameSet(items: readonly string[]): ReadonlySet<string> {
  return new Set(items.map((item) => normalizeQname(item)));
}

// ── fk-path (task 1.2) — SET equality of `A.col=B.col` hop atoms, order-independent ──

/** Canonicalize an atom so `A.col=B.col` and `B.col=A.col` are the same member. */
function fkAtom(left: string, right: string): string {
  return [normalizeQname(left), normalizeQname(right)].sort().join('=');
}

export function compareFkPath(
  answerParsed: string,
  groundTruth: GroundTruthByFamily['fk-path'],
): ScoreResult {
  const expected = new Set<string>();
  for (const hop of groundTruth.hops) {
    for (const jc of hop.joinColumns) {
      expected.add(fkAtom(`${hop.fromTable}.${jc.fromColumn}`, `${hop.toTable}.${jc.toColumn}`));
    }
  }

  const got = new Set<string>();
  for (const item of splitList(answerParsed.replace(/;/g, ','))) {
    const sides = item.split('=');
    if (sides.length !== 2) continue; // malformed atom → cannot match, no partial credit
    got.add(fkAtom(sides[0] ?? '', sides[1] ?? ''));
  }

  const correct = setEquals(expected, got);
  return {
    correct,
    expected: displaySet(expected),
    got: displaySet(got),
    detail: correct ? 'fk-path atom set match' : 'fk-path atom set mismatch',
  };
}

// ── column-type (task 1.3) — EXACT `TYPE|NULLABLE`, synonym-normalized, control family ──

function canonicalNullable(token: string): string {
  return token.replace(/\s+/g, ' ').trim().toUpperCase();
}

export function compareColumnType(
  answerParsed: string,
  groundTruth: GroundTruthByFamily['column-type'],
): ScoreResult {
  const expected = `${canonicalType(groundTruth.dataType)}|${groundTruth.nullable ? 'NULL' : 'NOT NULL'}`;

  const parts = answerParsed.split('|');
  const got =
    parts.length === 2
      ? `${canonicalType(parts[0] ?? '')}|${canonicalNullable(parts[1] ?? '')}`
      : answerParsed.trim();

  const correct = got === expected;
  return {
    correct,
    expected,
    got,
    detail: correct ? 'column-type exact match' : 'column-type mismatch',
  };
}

// ── impact (task 1.4) — SET equality of normalized whatToTest qnames ─────────

export function compareImpact(
  answerParsed: string,
  groundTruth: GroundTruthByFamily['impact'],
): ScoreResult {
  const expected = toQnameSet(groundTruth.whatToTest);
  const got = toQnameSet(splitList(answerParsed));
  const correct = setEquals(expected, got);
  return {
    correct,
    expected: displaySet(expected),
    got: displaySet(got),
    detail: correct ? 'impact qname set match' : 'impact qname set mismatch',
  };
}

// ── trigger-inventory (task 1.4) — STRICT SET of {qname,timing,events} tuples ─

/** Canonical tuple string: `qname:timing:event1|event2` with events uppercased + sorted. */
function triggerAtom(triggerQname: string, timing: string, events: readonly string[]): string {
  const qname = normalizeQname(triggerQname);
  const canonicalTiming = timing.replace(/\s+/g, ' ').trim().toUpperCase();
  const canonicalEvents = [...events]
    .map((event) => event.trim().toUpperCase())
    .filter((event) => event.length > 0)
    .sort()
    .join('|');
  return `${qname}:${canonicalTiming}:${canonicalEvents}`;
}

export function compareTriggerInventory(
  answerParsed: string,
  groundTruth: GroundTruthByFamily['trigger-inventory'],
): ScoreResult {
  const expected = new Set<string>();
  for (const trigger of groundTruth.triggers) {
    expected.add(triggerAtom(trigger.triggerQname, trigger.timing, trigger.events));
  }

  const got = new Set<string>();
  for (const item of splitList(answerParsed)) {
    const seg = item.split(':');
    // A well-formed tuple has EXACTLY three segments (qname:timing:events). A malformed
    // tuple yields a non-matching atom (empty timing/events) → the set cannot match.
    got.add(triggerAtom(seg[0] ?? '', seg[1] ?? '', (seg[2] ?? '').split('|')));
  }

  const correct = setEquals(expected, got);
  return {
    correct,
    expected: displaySet(expected),
    got: displaySet(got),
    detail: correct ? 'trigger tuple set match' : 'trigger tuple set mismatch',
  };
}

// ── view-dependency (task 1.5) — SET equality of normalized dependency qnames ─

export function compareViewDependency(
  answerParsed: string,
  groundTruth: GroundTruthByFamily['view-dependency'],
): ScoreResult {
  const expected = toQnameSet(groundTruth.dependencies);
  const got = toQnameSet(splitList(answerParsed));
  const correct = setEquals(expected, got);
  return {
    correct,
    expected: displaySet(expected),
    got: displaySet(got),
    detail: correct ? 'view-dependency qname set match' : 'view-dependency qname set mismatch',
  };
}

// ── constraint-semantics (task 1.5) — ORDERED list for PK, else SET equality ──

export function compareConstraintSemantics(
  answerParsed: string,
  groundTruth: GroundTruthByFamily['constraint-semantics'],
): ScoreResult {
  const expectedList = groundTruth.columns.map((column) => normalizeQname(column));
  const gotList = splitList(answerParsed).map((column) => normalizeQname(column));

  const correct = groundTruth.ordered
    ? gotList.length === expectedList.length &&
      gotList.every((column, index) => column === expectedList[index])
    : setEquals(new Set(expectedList), new Set(gotList));

  return {
    correct,
    expected: expectedList.join(', '),
    got: gotList.join(', '),
    detail: correct
      ? `constraint-semantics ${groundTruth.ordered ? 'ordered' : 'set'} match`
      : `constraint-semantics ${groundTruth.ordered ? 'ordered' : 'set'} mismatch`,
  };
}
