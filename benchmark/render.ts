/**
 * Stage 4 renderer — `render.ts` (US-035, design §Scorer). DEV/orchestrator tooling, NOT a vitest
 * suite. Run via `node --experimental-strip-types benchmark/render.ts <aggregate.json>`.
 *
 * Turns a scored `aggregate.json` into the `docs/benchmarks.md` Results table, in STABLE order
 * (the aggregate is already emitted in canonical family order by score.ts). Prints the markdown to
 * stdout; the ORCHESTRATOR (Batch R) captures it into the Results section of docs/benchmarks.md,
 * which already carries the limitations + anti-extrapolation contract. This stage writes NO numbers
 * of its own and reads NO ground truth — it only reformats the blind scorer's aggregate.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface AggregateSide {
  readonly correct: number;
  readonly total: number;
  readonly accuracyPct: number;
  readonly schemaTokens: number;
}
interface FamilyRow {
  readonly family: string;
  readonly with: AggregateSide;
  readonly without: AggregateSide;
}
interface Aggregate {
  readonly families: readonly FamilyRow[];
  readonly overall: { readonly with: AggregateSide; readonly without: AggregateSide };
  readonly tokens: {
    readonly withTotal: number;
    readonly withoutTotal: number;
    readonly deltaWithMinusWithout: number;
  };
}

const aggPath = process.argv[2] !== undefined ? resolve(process.argv[2]) : '';
if (aggPath === '' || !existsSync(aggPath)) {
  throw new Error('render: expected a path to aggregate.json (render.ts <aggregate.json>).');
}

const agg = JSON.parse(readFileSync(aggPath, 'utf8')) as Aggregate;

const pct = (s: AggregateSide): string => `${s.accuracyPct}% (${s.correct}/${s.total})`;

const lines: string[] = [];
lines.push('| Family | WITH accuracy | WITHOUT accuracy | WITH schema-tokens | WITHOUT schema-tokens |');
lines.push('|--------|---------------|------------------|--------------------|-----------------------|');
for (const f of agg.families) {
  lines.push(
    `| ${f.family} | ${pct(f.with)} | ${pct(f.without)} | ${f.with.schemaTokens} | ${f.without.schemaTokens} |`,
  );
}
lines.push(
  `| **Overall** | ${pct(agg.overall.with)} | ${pct(agg.overall.without)} | ${agg.overall.with.schemaTokens} | ${agg.overall.without.schemaTokens} |`,
);
lines.push('');
lines.push(
  `Schema-token delta (WITH − WITHOUT): ${agg.tokens.deltaWithMinusWithout} ` +
    `(WITH ${agg.tokens.withTotal} vs WITHOUT ${agg.tokens.withoutTotal}).`,
);

process.stdout.write(`${lines.join('\n')}\n`);
