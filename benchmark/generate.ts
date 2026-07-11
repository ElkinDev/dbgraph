/**
 * Stage 1 — `generate.ts` (US-035, design §Question generation). DEV/orchestrator tooling,
 * NOT a vitest suite (coupling `npm test` to a run would be a Req-6 violation). Run via
 * `node --experimental-strip-types benchmark/generate.ts --project <graph-dir>`.
 *
 * Emits the FROZEN, pre-registered question set + mechanical ground truth from the BUILT
 * graph, reading ONLY through the shipped store API (`createSqliteGraphStore` from `dist/`)
 * and `dist/cli.js affected --json` — it NEVER re-implements extraction (D5). Fully
 * deterministic: lexicographic selection, no seed, no randomness, no timestamps (ADR-008) —
 * regenerating from the committed torture fixture reproduces every artifact byte-for-byte.
 *
 * Correctness is enforced by RUNTIME SELF-CHECK ASSERTIONS (fail loudly): N is fixed in
 * [5,10], every ground-truth key carries a `source_ddl_ref`, and no answer value leaks into
 * its question text (D5 leakage guard).
 *
 * SUBSTRATE NOTE: on SQLite the `view-dependency` family is INSTANTIABLE — the SQLite
 * schema adapter derives view `depends_on` edges from bodies via the shared presence-gate
 * tokenizer (sqlite-view-deps), so the enumerator yields candidates. The committed set is
 * the run-3 pre-registered N=6 set with `view-dependency` INCLUDED: its formerly-deferred
 * labeled run is THIS one, unblocked by benchmark-guard-precision (the no-leak guard's
 * alphanumeric-adjacency precision) — `--per-family 1` here gives N=6.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Types come from src (erased at runtime) so `tsc --noEmit` never depends on a
// built dist/ being present; the RUNTIME import below still consumes the built
// artifact because `node --experimental-strip-types` cannot remap .js -> .ts.
import type {
  GraphStore,
  GraphNode,
  ColumnPayload,
  ConstraintPayload,
  TriggerPayload,
} from '../src/index.js';

const { createSqliteGraphStore } = (await import(
  '../dist/index.js' as string
)) as typeof import('../src/index.js');
import type { Family, FkHop, TriggerTuple } from './scorer/index.js';
import {
  occursStandalone,
  excludeScopeBlock,
  buildScopeBlock,
  nBoundsForSubstrate,
  auditPlanKey,
} from './harness-checks.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic helpers (ADR-008 — locale-independent, no randomness)
// ─────────────────────────────────────────────────────────────────────────────

/** Locale-independent, byte-stable string comparator. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Remove the leading `main.` schema segment, yielding unqualified names. */
function stripSchema(qname: string): string {
  const parts = qname.split('.');
  return parts[0] === 'main' ? parts.slice(1).join('.') : qname;
}

interface QuestionRecord {
  readonly qid: string;
  readonly family: Family;
  readonly sortKey: string;
  readonly question: string;
  readonly answerFormat: string;
  readonly groundTruth: Readonly<Record<string, unknown>>;
  /** Answer value tokens that MUST NOT appear in the question text (leakage guard). */
  readonly answerTokens: readonly string[];
  readonly sourceObject: string;
  /** For impact questions: the committed snippet file basename (qid). */
  readonly snippetQid?: string;
}

// Answer-format SHAPE specs (per-family canonical form; examples are FICTIONAL — they never
// coincide with a real torture-fixture answer, so embedding them leaks nothing).
const FK_FORMAT =
  'Semicolon-separated join atoms fromTable.fromColumn=toTable.toColumn using unqualified table names; order does not matter (e.g. "orders.cust_id=customers.id; orders.region=customers.region").';
const COLTYPE_FORMAT =
  'The declared type and nullability as TYPE|NULLABLE, where NULLABLE is NULL or NOT NULL (e.g. "VARCHAR|NULL").';
const IMPACT_FORMAT =
  'Comma-separated, alphabetically sorted list of unqualified object names (e.g. "orders, shipments").';
const TRIGGER_FORMAT =
  'Comma-separated tuples name:timing:events, where events is a |-separated sorted list; tuple order does not matter (e.g. "trg_x:AFTER:INSERT|UPDATE").';
const DEP_FORMAT =
  'Comma-separated, alphabetically sorted list of unqualified object names the view reads from (e.g. "orders, products").';
const PK_FORMAT =
  'Comma-separated primary-key column names in their DECLARED order — order matters (e.g. "tenant_id, id").';

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: readonly string[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token !== undefined && token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      out[key] = next !== undefined && !next.startsWith('--') ? ((i += 1), next) : 'true';
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// DDL source-ref index (D5 — auditable pointer key → torture.sql)
// ─────────────────────────────────────────────────────────────────────────────

function buildDdlIndex(ddlPath: string, ddlRef: string): Map<string, string> {
  const index = new Map<string, string>();
  const lines = readFileSync(ddlPath, 'utf8').split(/\r?\n/);
  const re = /^\s*CREATE\s+(?:TABLE|VIEW|TRIGGER)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i;
  for (let i = 0; i < lines.length; i += 1) {
    const m = re.exec(lines[i] ?? '');
    if (m && m[1] !== undefined && !index.has(m[1])) {
      index.set(m[1], `${ddlRef}:L${i + 1}`);
    }
  }
  return index;
}

function sourceRef(index: Map<string, string>, ddlRef: string, object: string): string {
  return index.get(object) ?? `${ddlRef}#${object}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-family mechanical derivation (each returns records sorted by sortKey)
// ─────────────────────────────────────────────────────────────────────────────

async function columnsOf(store: GraphStore, tableName: string): Promise<readonly GraphNode[]> {
  const prefix = `main.${tableName}.`;
  const all = await store.getNodesByKind('column');
  return all.filter((c) => c.qname.startsWith(prefix));
}

async function deriveFkPath(
  store: GraphStore,
  ddlIndex: Map<string, string>,
  ddlRef: string,
): Promise<QuestionRecord[]> {
  const records: QuestionRecord[] = [];
  for (const table of await store.getNodesByKind('table')) {
    const edges = await store.getEdgesFrom(table.id, ['references']);
    const byConstraint = new Map<string, { srcColumn: string; dstColumn: string; dstId: string }[]>();
    for (const e of edges) {
      const { srcColumn, dstColumn, constraintName } = e.attrs;
      if (srcColumn === undefined || dstColumn === undefined || constraintName === undefined) continue;
      const list = byConstraint.get(constraintName) ?? [];
      list.push({ srcColumn, dstColumn, dstId: e.dst });
      byConstraint.set(constraintName, list);
    }
    for (const cols of byConstraint.values()) {
      const first = cols[0];
      if (first === undefined) continue;
      const toNode = await store.getNode(first.dstId);
      if (toNode === null) continue;
      const fromTable = stripSchema(table.qname);
      const toTable = stripSchema(toNode.qname);
      const joinColumns = cols
        .map((c) => ({ fromColumn: c.srcColumn, toColumn: c.dstColumn }))
        .sort((a, b) => cmp(a.fromColumn + a.toColumn, b.fromColumn + b.toColumn));
      const hop: FkHop = { fromTable, toTable, joinColumns };
      const answerTokens = joinColumns.flatMap((j) => [
        `${fromTable}.${j.fromColumn}=${toTable}.${j.toColumn}`,
        j.fromColumn,
        j.toColumn,
      ]);
      records.push({
        qid: `fk-path-${fromTable}-${toTable}`,
        family: 'fk-path',
        sortKey: `${fromTable}|${toTable}`,
        question: `What foreign-key join path connects the tables ${fromTable} and ${toTable}?`,
        answerFormat: FK_FORMAT,
        groundTruth: { hops: [hop], source_ddl_ref: sourceRef(ddlIndex, ddlRef, fromTable) },
        answerTokens,
        sourceObject: fromTable,
      });
    }
  }
  return records.sort((a, b) => cmp(a.sortKey, b.sortKey));
}

async function deriveColumnType(
  store: GraphStore,
  ddlIndex: Map<string, string>,
  ddlRef: string,
): Promise<QuestionRecord[]> {
  const records: QuestionRecord[] = [];
  for (const col of await store.getNodesByKind('column')) {
    const payload = col.payload as unknown as ColumnPayload;
    const key = stripSchema(col.qname); // table.column
    const table = key.split('.')[0] ?? key;
    const dataType = String(payload.dataType);
    const nullable = Boolean(payload.nullable);
    const nullableToken = nullable ? 'NULL' : 'NOT NULL';
    records.push({
      qid: `column-type-${key}`,
      family: 'column-type',
      sortKey: key,
      question: `What is the declared SQL data type and nullability of the column ${key}?`,
      answerFormat: COLTYPE_FORMAT,
      groundTruth: { dataType, nullable, source_ddl_ref: sourceRef(ddlIndex, ddlRef, table) },
      answerTokens: [dataType, nullableToken, `${dataType}|${nullableToken}`],
      sourceObject: table,
    });
  }
  return records.sort((a, b) => cmp(a.sortKey, b.sortKey));
}

async function deriveTriggerInventory(
  store: GraphStore,
  ddlIndex: Map<string, string>,
  ddlRef: string,
): Promise<QuestionRecord[]> {
  const byTarget = new Map<string, TriggerTuple[]>();
  for (const trigger of await store.getNodesByKind('trigger')) {
    const payload = trigger.payload as unknown as TriggerPayload;
    const edges = await store.getEdgesFrom(trigger.id, ['fires_on']);
    const targetIds = new Set(edges.map((e) => e.dst));
    for (const tid of targetIds) {
      const target = await store.getNode(tid);
      if (target === null) continue;
      const key = stripSchema(target.qname);
      const list = byTarget.get(key) ?? [];
      list.push({
        triggerQname: stripSchema(trigger.qname),
        timing: String(payload.timing ?? ''),
        events: [...payload.events].map(String),
      });
      byTarget.set(key, list);
    }
  }
  const records: QuestionRecord[] = [];
  for (const [target, triggers] of byTarget) {
    const sorted: TriggerTuple[] = triggers
      .map((t) => ({ triggerQname: t.triggerQname, timing: t.timing, events: [...t.events].sort(cmp) }))
      .sort((a, b) => cmp(a.triggerQname, b.triggerQname));
    const answerTokens = sorted.flatMap((t) => [
      t.triggerQname,
      t.timing,
      ...t.events,
      `${t.triggerQname}:${t.timing}:${t.events.join('|')}`,
    ]);
    records.push({
      qid: `trigger-inventory-${target}`,
      family: 'trigger-inventory',
      sortKey: target,
      question: `Which triggers are defined on ${target}? For each trigger give its name, timing, and the events it fires on.`,
      answerFormat: TRIGGER_FORMAT,
      groundTruth: { triggers: sorted, source_ddl_ref: sourceRef(ddlIndex, ddlRef, target) },
      answerTokens,
      sourceObject: target,
    });
  }
  return records.sort((a, b) => cmp(a.sortKey, b.sortKey));
}

async function deriveViewDependency(
  store: GraphStore,
  ddlIndex: Map<string, string>,
  ddlRef: string,
): Promise<QuestionRecord[]> {
  const records: QuestionRecord[] = [];
  for (const view of await store.getNodesByKind('view')) {
    const edges = await store.getEdgesFrom(view.id, ['depends_on', 'reads_from']);
    if (edges.length === 0) continue; // view with no body-derived depends_on/reads_from → skip
    const deps: string[] = [];
    for (const e of edges) {
      const dep = await store.getNode(e.dst);
      if (dep !== null) deps.push(stripSchema(dep.qname));
    }
    const dependencies = [...new Set(deps)].sort(cmp);
    const key = stripSchema(view.qname);
    records.push({
      qid: `view-dependency-${key}`,
      family: 'view-dependency',
      sortKey: key,
      question: `Which tables or objects does the view ${key} read from (its direct dependencies)?`,
      answerFormat: DEP_FORMAT,
      groundTruth: { dependencies, source_ddl_ref: sourceRef(ddlIndex, ddlRef, key) },
      answerTokens: [...dependencies, dependencies.join(', ')],
      sourceObject: key,
    });
  }
  return records.sort((a, b) => cmp(a.sortKey, b.sortKey));
}

async function deriveConstraintSemantics(
  store: GraphStore,
  ddlIndex: Map<string, string>,
  ddlRef: string,
): Promise<QuestionRecord[]> {
  const records: QuestionRecord[] = [];
  for (const constraint of await store.getNodesByKind('constraint')) {
    const payload = constraint.payload as unknown as ConstraintPayload;
    if (payload.type !== 'PK') continue; // PK is the order-SENSITIVE case
    const owner = (stripSchema(constraint.qname).split('.')[0] ?? '').trim();
    const columns = [...payload.columns].map(String);
    records.push({
      qid: `constraint-semantics-${owner}`,
      family: 'constraint-semantics',
      sortKey: owner,
      question: `List the columns of the PRIMARY KEY of table ${owner}, in their declared order.`,
      answerFormat: PK_FORMAT,
      groundTruth: { columns, ordered: true, source_ddl_ref: sourceRef(ddlIndex, ddlRef, owner) },
      answerTokens: [...columns, columns.join(', ')],
      sourceObject: owner,
    });
  }
  return records.sort((a, b) => cmp(a.sortKey, b.sortKey));
}

interface AffectedJson {
  readonly impact: { readonly whatToTest: readonly string[] };
}

/**
 * Run `affected <snippet> --json` and return the parsed impact. NOTE: `affected` uses
 * grep-like exit codes — it exits 1 when it FINDS impacted objects (a CI change-detection
 * gate), which is the EXPECTED path here. `execFileSync` throws on a non-zero exit, so we
 * recover the captured stdout from the thrown error and parse it.
 */
function runAffectedJson(cliPath: string, snippetPath: string, projectDir: string): AffectedJson {
  let stdout: string;
  try {
    stdout = execFileSync('node', [cliPath, 'affected', snippetPath, '--json'], {
      cwd: projectDir,
      encoding: 'utf8',
    });
  } catch (err) {
    const recovered = (err as { stdout?: string }).stdout;
    if (typeof recovered !== 'string' || recovered.trim().length === 0) throw err;
    stdout = recovered;
  }
  return JSON.parse(stdout) as AffectedJson;
}

async function deriveImpact(
  store: GraphStore,
  ddlIndex: Map<string, string>,
  ddlRef: string,
  cliPath: string,
  projectDir: string,
  snippetsDir: string,
): Promise<QuestionRecord[]> {
  const records: QuestionRecord[] = [];
  const tables = [...(await store.getNodesByKind('table'))].sort((a, b) => cmp(a.name, b.name));
  for (const table of tables) {
    const cols = [...(await columnsOf(store, table.name))].sort(
      (a, b) => Number(a.payload.ordinal) - Number(b.payload.ordinal),
    );
    const firstCol = cols[0];
    if (firstCol === undefined) continue;
    const qid = `impact-${table.name}`;
    const snippet = `ALTER TABLE main.${table.name} DROP COLUMN ${firstCol.name};\n`;
    const snippetPath = join(snippetsDir, `${qid}.sql`);
    writeFileSync(snippetPath, snippet);
    const parsed = runAffectedJson(cliPath, snippetPath, projectDir);
    const whatToTest = [...parsed.impact.whatToTest].map(stripSchema).sort(cmp);
    if (whatToTest.length === 0) {
      rmSync(snippetPath); // not a candidate — do not keep an empty-impact snippet
      continue;
    }
    records.push({
      qid,
      family: 'impact',
      sortKey: qid,
      question: `A developer proposes the following DDL change:\n${snippet.trim()}\nWhich existing database objects should be re-tested as a result of this change?`,
      answerFormat: IMPACT_FORMAT,
      groundTruth: { whatToTest, source_ddl_ref: sourceRef(ddlIndex, ddlRef, table.name) },
      answerTokens: [...whatToTest, whatToTest.join(', ')],
      sourceObject: table.name,
      snippetQid: qid,
    });
  }
  return records.sort((a, b) => cmp(a.sortKey, b.sortKey));
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization (deterministic YAML + JSON; no library, zero new deps)
// ─────────────────────────────────────────────────────────────────────────────

function yamlString(value: string): string {
  return JSON.stringify(value); // JSON strings are valid YAML double-quoted scalars
}

function renderQuestionsYaml(
  perFamily: number,
  n: number,
  included: readonly Family[],
  excluded: readonly Family[],
  questions: readonly QuestionRecord[],
  substrate: string,
): string {
  const lines: string[] = [];
  lines.push('# dbgraph benchmark — pre-registered question set (US-035, benchmark spec Req 2).');
  lines.push('# GENERATED by benchmark/generate.ts — do NOT edit by hand.');
  lines.push('# Deterministic: regenerating from the committed torture fixture reproduces this');
  lines.push('# file byte-for-byte. Ground truth is held SEPARATELY under benchmark/ground-truth/.');
  lines.push('version: 1');
  lines.push(`substrate: ${substrate}`);
  lines.push(`perFamily: ${perFamily}`);
  lines.push(`n: ${n}`);
  lines.push('familiesIncluded:');
  for (const f of included) lines.push(`  - ${f}`);
  lines.push('familiesExcluded:');
  for (const f of excluded) lines.push(`  - ${f}`);
  lines.push('notes:');
  lines.push(
    `  view-dependency: ${yamlString('INCLUDED as of the N=6 run-3 set. The SQLite adapter derives view depends_on edges from bodies (sqlite-view-deps); benchmark-guard-precision made the no-leak guard alphanumeric-adjacency-precise, unblocking this family for its own labeled run — this pre-registration.')}`,
  );
  lines.push('questions:');
  for (const q of questions) {
    lines.push(`  - qid: ${q.qid}`);
    lines.push(`    family: ${q.family}`);
    lines.push(`    question: ${yamlString(q.question)}`);
    lines.push(`    answerFormat: ${yamlString(q.answerFormat)}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderGroundTruthJson(groundTruth: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(groundTruth, null, 2)}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-checks (task 2.5 — fail LOUDLY)
// ─────────────────────────────────────────────────────────────────────────────

function assertNInBounds(n: number, substrate: string): void {
  // Substrate-aware bound (r3): sqlite lookup sets 5..10, mssql-torture planning set 3..10. The
  // bound's INTENT is anti-cherry-picking — every committed question in a pre-registered set runs
  // and is reported, none dropped. The sqlite default (5..10) is byte-identical to the prior check.
  const { min, max } = nBoundsForSubstrate(substrate);
  if (!(n >= min && n <= max)) {
    throw new Error(
      `SELF-CHECK FAILED: N=${n} is outside the pre-registered bound ${min} <= N <= ${max} for substrate "${substrate}" (spec Req 1/r3).`,
    );
  }
}

function assertSourceRefs(questions: readonly QuestionRecord[]): void {
  for (const q of questions) {
    const ref = q.groundTruth['source_ddl_ref'];
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new Error(`SELF-CHECK FAILED: ground-truth for ${q.qid} is missing a source_ddl_ref (D5).`);
    }
  }
}

function assertNoAnswerLeak(questions: readonly QuestionRecord[]): void {
  for (const q of questions) {
    // r2: a served SCOPE block (scope-list planning families) is FAIR input the agent must read,
    // so its region is EXCLUDED from the leak scan via the SAME shared helper build-packets uses.
    // Questions with no scope markers (every sqlite family) are returned unchanged — byte-identical.
    const haystack = excludeScopeBlock(q.question).toLowerCase();
    for (const token of q.answerTokens) {
      const needle = token.trim().toLowerCase();
      // A leak is a STANDALONE occurrence — one NOT flanked by an alphanumeric-or-underscore
      // char (`[a-z0-9_]`, the project's alphanumeric-adjacency convention, NOT a `\b` regex).
      // A key value that appears ONLY inside a larger identifier (e.g. `departments` within
      // `active_departments`) is NOT a leak; `occursStandalone` matches the token literally.
      if (needle.length >= 2 && occursStandalone(haystack, needle)) {
        throw new Error(
          `SELF-CHECK FAILED: answer value "${token}" leaks into the question text of ${q.qid} (D5 leakage guard).`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mssql-torture read-key path (D2 — anti-circularity carve-out, Req 1)
// Reads the COMMITTED hand-planted plan-* keys, opens NO store, and NEVER calls
// affected/getImpact. The scope-list families serve the marked scope block (r2);
// the leak guard strips it via `excludeScopeBlock` so the scope is fair input.
// ─────────────────────────────────────────────────────────────────────────────

/** Build the QuestionRecord for one committed plan-* key (question + scope block where applicable). */
function buildPlanQuestionRecord(key: Record<string, unknown>): QuestionRecord {
  const family = key['family'] as Family;
  const qid = String(key['qid']);
  const prose = String(key['question']);
  const answerFormat = String(key['answerFormat']);
  const sourceDdlRef = String(key['source_ddl_ref']);
  const sourceRefs = key['source_ddl_refs'] as Record<string, string>;

  if (family === 'plan-callers') {
    const callers = (key['callers'] ?? []) as readonly string[];
    return {
      qid,
      family,
      sortKey: qid,
      question: prose, // plan-callers serves NO scope block (standard guard, D2a)
      answerFormat,
      groundTruth: { callers, source_ddl_ref: sourceDdlRef, source_ddl_refs: sourceRefs },
      answerTokens: [...callers, callers.join(', ')],
      sourceObject: String(key['callee'] ?? qid),
    };
  }
  if (family === 'plan-blindspots') {
    const scope = (key['scope'] ?? []) as readonly string[];
    const blindSpots = (key['blind_spots'] ?? []) as readonly string[];
    return {
      qid,
      family,
      sortKey: qid,
      question: `${prose}\n\n${buildScopeBlock(scope)}`,
      answerFormat,
      groundTruth: { blind_spots: blindSpots, scope, source_ddl_ref: sourceDdlRef, source_ddl_refs: sourceRefs },
      answerTokens: [...blindSpots, blindSpots.join(', ')],
      sourceObject: qid,
    };
  }
  // plan-order
  const scope = (key['scope'] ?? []) as readonly string[];
  const precede = (key['precede'] ?? []) as readonly (readonly [string, string])[];
  return {
    qid,
    family,
    sortKey: qid,
    question: `${prose}\n\n${buildScopeBlock(scope)}`,
    answerFormat,
    groundTruth: { scope, precede, source_ddl_ref: sourceDdlRef, source_ddl_refs: sourceRefs },
    answerTokens: [...scope, scope.join(', ')],
    sourceObject: qid,
  };
}

/** Generate the mssql-torture planning set from committed keys (read-key path; no store). */
function generateMssqlPlanSet(
  planningKeysDir: string,
  mssqlDdlPath: string,
  outDir: string,
  groundTruthDir: string,
  substrate: string,
): void {
  if (!existsSync(planningKeysDir)) {
    throw new Error(`generate --substrate mssql-torture: planning-keys dir not found at ${planningKeysDir}.`);
  }
  const files = readdirSync(planningKeysDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`generate --substrate mssql-torture: no committed plan-* keys under ${planningKeysDir}.`);
  }
  const ddlText = readFileSync(mssqlDdlPath, 'utf8');

  const records: QuestionRecord[] = [];
  const included: Family[] = [];
  for (const file of files) {
    const key = JSON.parse(readFileSync(join(planningKeysDir, file), 'utf8')) as Record<string, unknown>;
    // Anti-circularity self-check (Req1): every planted fact MUST be auditable against the DDL.
    // Keys are READ here — there is NO getImpact/affected call on this path.
    for (const r of auditPlanKey(key, ddlText)) {
      if (!r.ok) throw new Error(`SELF-CHECK FAILED (plan-key audit): ${r.detail}`);
    }
    records.push(buildPlanQuestionRecord(key));
    const fam = key['family'] as Family;
    if (!included.includes(fam)) included.push(fam);
  }
  records.sort((a, b) => cmp(a.qid, b.qid));

  const n = records.length;
  assertNInBounds(n, substrate); // r3 anti-cherry-pick: every committed question runs (none dropped)
  assertSourceRefs(records);
  assertNoAnswerLeak(records); // scope block excluded via excludeScopeBlock (A1.3)

  mkdirSync(groundTruthDir, { recursive: true });
  writeFileSync(join(outDir, 'questions.yaml'), renderQuestionsYaml(1, n, included, [], records, substrate));
  for (const q of records) {
    writeFileSync(join(groundTruthDir, `${q.qid}.json`), renderGroundTruthJson(q.groundTruth));
  }
  process.stdout.write(`generate: N=${n} (substrate=${substrate}); families=[${included.join(', ')}]\n`);
  for (const q of records) process.stdout.write(`  ${q.qid} (${q.family})\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(benchmarkDir);

const projectDir = args['project'] !== undefined ? resolve(args['project']) : process.cwd();
const graphPath = args['graph'] !== undefined ? resolve(args['graph']) : join(projectDir, '.dbgraph', 'dbgraph.db');
const cliPath = args['cli'] !== undefined ? resolve(args['cli']) : join(repoRoot, 'dist', 'cli.js');
const outDir = args['out'] !== undefined ? resolve(args['out']) : benchmarkDir;
const ddlPath =
  args['ddl'] !== undefined ? resolve(args['ddl']) : join(repoRoot, 'test', 'fixtures', 'sqlite', 'torture.sql');
const ddlRef = 'test/fixtures/sqlite/torture.sql';
const perFamily = args['per-family'] !== undefined ? Number.parseInt(args['per-family'], 10) : 1;
const substrate = args['substrate'] !== undefined ? String(args['substrate']) : 'sqlite-torture';

// mssql-torture reads committed keys and writes its own set BEFORE the sqlite derivation below —
// which stays byte-identical (this branch never runs on the default `sqlite-torture` substrate).
if (substrate === 'mssql-torture') {
  const planningKeysDir =
    args['planning-keys'] !== undefined ? resolve(args['planning-keys']) : join(benchmarkDir, 'planning-keys');
  const mssqlDdlPath =
    args['ddl'] !== undefined ? resolve(args['ddl']) : join(repoRoot, 'test', 'fixtures', 'mssql', 'torture.sql');
  generateMssqlPlanSet(planningKeysDir, mssqlDdlPath, outDir, join(outDir, 'ground-truth'), substrate);
  process.exit(0);
}

if (!existsSync(graphPath)) {
  throw new Error(`Built graph not found at ${graphPath}. Build it first: dbgraph init --dialect sqlite --file <torture.db>.`);
}
if (!Number.isInteger(perFamily) || perFamily < 1) {
  throw new Error(`--per-family must be a positive integer, got ${String(args['per-family'])}.`);
}

const groundTruthDir = join(outDir, 'ground-truth');
const snippetsDir = join(outDir, 'impact-snippets');
mkdirSync(groundTruthDir, { recursive: true });
mkdirSync(snippetsDir, { recursive: true });

const store = await createSqliteGraphStore({ path: graphPath });

// The SIX family enumerators (D6). Order is the canonical family order.
const FAMILY_ORDER: readonly Family[] = [
  'fk-path',
  'column-type',
  'impact',
  'trigger-inventory',
  'view-dependency',
  'constraint-semantics',
];

const ddlIndex = buildDdlIndex(ddlPath, ddlRef);

const candidatesByFamily = new Map<Family, QuestionRecord[]>([
  ['fk-path', await deriveFkPath(store, ddlIndex, ddlRef)],
  ['column-type', await deriveColumnType(store, ddlIndex, ddlRef)],
  ['impact', await deriveImpact(store, ddlIndex, ddlRef, cliPath, projectDir, snippetsDir)],
  ['trigger-inventory', await deriveTriggerInventory(store, ddlIndex, ddlRef)],
  ['view-dependency', await deriveViewDependency(store, ddlIndex, ddlRef)],
  ['constraint-semantics', await deriveConstraintSemantics(store, ddlIndex, ddlRef)],
]);

await store.close();

// First-N-lexicographic selection per family (D7 — no randomness).
const selected: QuestionRecord[] = [];
const included: Family[] = [];
const excluded: Family[] = [];
for (const family of FAMILY_ORDER) {
  const candidates = candidatesByFamily.get(family) ?? [];
  const pick = candidates.slice(0, perFamily);
  if (pick.length > 0) {
    included.push(family);
    selected.push(...pick);
  } else {
    excluded.push(family);
  }
}
selected.sort((a, b) => cmp(a.qid, b.qid));

// Prune impact snippets that were probed but not selected (keep only committed picks).
const selectedSnippets = new Set(selected.filter((q) => q.snippetQid !== undefined).map((q) => q.snippetQid));
for (const candidate of candidatesByFamily.get('impact') ?? []) {
  if (candidate.snippetQid !== undefined && !selectedSnippets.has(candidate.snippetQid)) {
    const path = join(snippetsDir, `${candidate.snippetQid}.sql`);
    if (existsSync(path)) rmSync(path);
  }
}

const n = selected.length;

// ── Self-checks (fail loudly BEFORE writing the frozen set) ──────────────────
assertNInBounds(n, substrate);
assertSourceRefs(selected);
assertNoAnswerLeak(selected);

// ── Write the frozen pre-registered set ──────────────────────────────────────
writeFileSync(
  join(outDir, 'questions.yaml'),
  renderQuestionsYaml(perFamily, n, included, excluded, selected, substrate),
);
for (const q of selected) {
  writeFileSync(join(groundTruthDir, `${q.qid}.json`), renderGroundTruthJson(q.groundTruth));
}

process.stdout.write(
  `generate: N=${n} (perFamily=${perFamily}); included=[${included.join(', ')}]; excluded=[${excluded.join(', ')}]\n`,
);
for (const q of selected) process.stdout.write(`  ${q.qid} (${q.family})\n`);
