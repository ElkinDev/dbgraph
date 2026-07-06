/**
 * Stage 4 driver — `score.ts` (US-035, design §Scorer). DEV/orchestrator tooling, NOT a vitest
 * suite (coupling `npm test` to a run would be a Req-6 violation). Run via
 * `node --experimental-strip-types benchmark/score.ts <run-dir>`.
 *
 * Reads every `<run-dir>/raw/<qid>.<condition>.json` transcript record, runs each answer through
 * the Batch-1 scorer, and emits:
 *   - <run-dir>/scored/per-question.json — { qid, family, with:{correct,tokens}, without:{correct,tokens} }
 *   - <run-dir>/aggregate.json           — per-family + overall accuracy per condition; token totals + delta
 *
 * BLINDNESS (D13): the `condition` field is read ONLY to bucket the result into with/without; it is
 * NEVER passed to the scorer. `scoreAnswer` receives exactly `{ family, answerParsed, groundTruth }`
 * — its input type carries no condition field, so blindness is enforced at compile time.
 *
 * Deterministic (ADR-008): canonical family order, no timestamps injected into the output (the
 * input `runId` is carried by the transcripts, not minted here).
 *
 * STRIP-TYPES NOTE (D3): imports scorer VALUES at runtime → explicit `.ts` specifiers.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreAnswer, FAMILIES, type Family, type ScoreInput, type TokenCount } from './scorer/index.ts';

// ── CLI args (positional <run-dir>, plus optional --ground-truth) ────────────

function parseArgs(argv: readonly string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      flags[key] = next !== undefined && !next.startsWith('--') ? ((i += 1), next) : 'true';
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

// ── Transcript record (design §Persistence) ──────────────────────────────────

interface RawRecord {
  readonly qid: string;
  readonly family: Family;
  readonly condition: 'with' | 'without';
  readonly answerParsed: string;
  readonly tokens: TokenCount;
}

interface ConditionResult {
  correct: boolean;
  tokens: TokenCount;
}

interface PerQuestion {
  qid: string;
  family: Family;
  with: ConditionResult | null;
  without: ConditionResult | null;
}

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const { positional, flags } = parseArgs(process.argv.slice(2));

const runDir = positional[0] !== undefined ? resolve(positional[0]) : '';
if (runDir === '' || !existsSync(join(runDir, 'raw'))) {
  throw new Error('score: expected a <run-dir> whose raw/ holds the transcript records (score.ts <run-dir>).');
}
const groundTruthDir =
  flags['ground-truth'] !== undefined ? resolve(flags['ground-truth']) : join(benchmarkDir, 'ground-truth');

const rawDir = join(runDir, 'raw');
const rawFiles = readdirSync(rawDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
if (rawFiles.length === 0) {
  throw new Error(`score: no raw transcript records under ${rawDir}.`);
}

// ── Score every record BLIND to its condition ────────────────────────────────

const byQid = new Map<string, PerQuestion>();

for (const file of rawFiles) {
  const rec = JSON.parse(readFileSync(join(rawDir, file), 'utf8')) as RawRecord;
  if (!FAMILIES.includes(rec.family)) {
    throw new Error(`score: ${file} has unknown family "${String(rec.family)}".`);
  }
  const gtPath = join(groundTruthDir, `${rec.qid}.json`);
  if (!existsSync(gtPath)) {
    throw new Error(`score: no ground-truth key for qid "${rec.qid}" (expected ${gtPath}).`);
  }
  const groundTruth = JSON.parse(readFileSync(gtPath, 'utf8')) as Record<string, unknown>;

  // BLIND scoring — the condition is NOT part of the scorer input (D13).
  const result = scoreAnswer({
    family: rec.family,
    answerParsed: rec.answerParsed,
    groundTruth,
  } as ScoreInput);

  const entry: PerQuestion = byQid.get(rec.qid) ?? {
    qid: rec.qid,
    family: rec.family,
    with: null,
    without: null,
  };
  entry[rec.condition] = { correct: result.correct, tokens: rec.tokens };
  byQid.set(rec.qid, entry);
}

const perQuestion = [...byQid.values()].sort((a, b) => (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0));

// ── Aggregate per family (canonical order) + overall ─────────────────────────

interface Tally {
  correct: number;
  total: number;
  schemaTokens: number;
}
const emptyTally = (): Tally => ({ correct: 0, total: 0, schemaTokens: 0 });
const accuracyPct = (t: Tally): number => (t.total > 0 ? Math.round((t.correct / t.total) * 1000) / 10 : 0);

function addTo(tally: Tally, r: ConditionResult | null): void {
  if (r === null) return;
  tally.total += 1;
  if (r.correct) tally.correct += 1;
  tally.schemaTokens += r.tokens.schemaTokens;
}

interface AggregateSide {
  correct: number;
  total: number;
  accuracyPct: number;
  schemaTokens: number;
}
const side = (t: Tally): AggregateSide => ({
  correct: t.correct,
  total: t.total,
  accuracyPct: accuracyPct(t),
  schemaTokens: t.schemaTokens,
});

const overallWith = emptyTally();
const overallWithout = emptyTally();
const families = FAMILIES.map((family) => {
  const w = emptyTally();
  const wo = emptyTally();
  for (const q of perQuestion) {
    if (q.family !== family) continue;
    addTo(w, q.with);
    addTo(wo, q.without);
  }
  return { family, with: side(w), without: side(wo) };
}).filter((f) => f.with.total > 0 || f.without.total > 0);

for (const q of perQuestion) {
  addTo(overallWith, q.with);
  addTo(overallWithout, q.without);
}

const aggregate = {
  families,
  overall: { with: side(overallWith), without: side(overallWithout) },
  tokens: {
    withTotal: overallWith.schemaTokens,
    withoutTotal: overallWithout.schemaTokens,
    deltaWithMinusWithout: overallWith.schemaTokens - overallWithout.schemaTokens,
  },
};

const scoredDir = join(runDir, 'scored');
mkdirSync(scoredDir, { recursive: true });
writeFileSync(join(scoredDir, 'per-question.json'), `${JSON.stringify(perQuestion, null, 2)}\n`);
writeFileSync(join(runDir, 'aggregate.json'), `${JSON.stringify(aggregate, null, 2)}\n`);

process.stdout.write(
  `score: ${perQuestion.length} question(s); WITH ${aggregate.overall.with.accuracyPct}% / WITHOUT ${aggregate.overall.without.accuracyPct}% ` +
    `(tokens WITH ${aggregate.tokens.withTotal} vs WITHOUT ${aggregate.tokens.withoutTotal})\n`,
);
