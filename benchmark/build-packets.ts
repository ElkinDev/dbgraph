/**
 * Stage 2 — `build-packets.ts` (US-035, design §Condition packet builder). DEV/orchestrator
 * tooling, NOT a vitest suite (coupling `npm test` to a run would be a Req-6 violation). Run via
 * `node --experimental-strip-types benchmark/build-packets.ts --db <target.db>`.
 *
 * Per pre-registered question, emits TWO prompt packets that share the IDENTICAL system framing,
 * question text, and answer-format spec and differ ONLY in schema access (spec Req 3):
 *   - packets/<qid>.with.md    — question + read-only dbgraph CLI doc block (D11). NO DDL, NO key.
 *   - packets/<qid>.without.md — question + the full comment-free `sqlite_master` DDL dump (D8).
 *                                NO tool docs, NO key.
 *
 * The DDL dump is the FAIREST realistic input (D8): the catalog DDL a developer inheriting the
 * database actually gets (`SELECT type,name,sql FROM sqlite_master ...`), NOT the annotated
 * torture.sql (whose teaching comments a real catalog never carries). Schema-token accounting
 * (D9) is computed via the SAME Batch-1 `scorer/tokens.ts` formula both sides — here the WITHOUT
 * dump (counted once); the WITH tool outputs are counted at run time (Batch R).
 *
 * Correctness is enforced by RUNTIME SELF-CHECK ASSERTIONS (fail loudly, task 3.3):
 *   - the WITH packet contains NO DDL; the WITHOUT packet contains NO tool docs;
 *   - NO ground-truth ANSWER value is embedded in EITHER packet (the DDL region — fair input the
 *     agent must still read and reason over — is EXCLUDED from the scan; only a pre-formatted
 *     answer pasted OUTSIDE the schema section would trip it).
 * A `promptSha256` per packet is recorded so verify can later confirm no key leaked.
 *
 * STRIP-TYPES NOTE (D3): this stage imports scorer VALUES at runtime, so it uses explicit `.ts`
 * specifiers (Node's `--experimental-strip-types` does NOT remap `.js`→`.ts`); the benchmark
 * tsconfig sets `allowImportingTsExtensions`. `generate.ts` only imports scorer TYPES (stripped),
 * so it keeps `.js`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { schemaTokens, type Family, type TokenCount } from './scorer/index.ts';
import {
  deriveCoverageTargets,
  verifyDumpCoverage,
  excludeScopeBlock,
  stripMssqlDdl,
} from './harness-checks.ts';

// ─────────────────────────────────────────────────────────────────────────────
// CLI args (mirrors generate.ts — no dependency on a YAML/arg library, ADR: zero new deps)
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
// questions.yaml parser — targeted to the deterministic single-line-JSON-scalar shape
// generate.ts emits (each `question:`/`answerFormat:` value is a JSON double-quoted scalar).
// ─────────────────────────────────────────────────────────────────────────────

interface QuestionRecord {
  readonly qid: string;
  readonly family: Family;
  readonly question: string;
  readonly answerFormat: string;
}

interface QuestionAcc {
  qid?: string;
  family?: Family;
  question?: string;
  answerFormat?: string;
}

function parseQuestionsYaml(text: string): QuestionRecord[] {
  const lines = text.split(/\r?\n/);
  const records: QuestionRecord[] = [];
  let acc: QuestionAcc = {};
  const flush = (): void => {
    if (acc.qid === undefined) {
      acc = {};
      return;
    }
    if (acc.family === undefined || acc.question === undefined || acc.answerFormat === undefined) {
      throw new Error(`questions.yaml: incomplete entry for qid "${acc.qid}".`);
    }
    records.push({ qid: acc.qid, family: acc.family, question: acc.question, answerFormat: acc.answerFormat });
    acc = {};
  };
  for (const line of lines) {
    const qid = /^\s*-\s*qid:\s*(.+?)\s*$/.exec(line);
    if (qid && qid[1] !== undefined) {
      flush();
      acc = { qid: qid[1] };
      continue;
    }
    if (acc.qid === undefined) continue;
    const family = /^\s*family:\s*(.+?)\s*$/.exec(line);
    if (family && family[1] !== undefined) {
      acc.family = family[1] as Family;
      continue;
    }
    const question = /^\s*question:\s*(.+)$/.exec(line);
    if (question && question[1] !== undefined) {
      acc.question = JSON.parse(question[1]) as string;
      continue;
    }
    const answerFormat = /^\s*answerFormat:\s*(.+)$/.exec(line);
    if (answerFormat && answerFormat[1] !== undefined) {
      acc.answerFormat = JSON.parse(answerFormat[1]) as string;
      continue;
    }
  }
  flush();
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment-free catalog DDL dump (D8) — the realistic `.schema`-equivalent an agent gets.
// ─────────────────────────────────────────────────────────────────────────────

interface SqliteMasterRow {
  readonly type: string;
  readonly name: string;
  readonly sql: string;
}

const DDL_DUMP_QUERY =
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name";

function buildDdlDump(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(DDL_DUMP_QUERY).all() as SqliteMasterRow[];
    // Each catalog CREATE statement, terminated with a semicolon and separated by a blank line —
    // deterministic (ORDER BY type,name), comment-free (sqlite_master.sql carries no standalone
    // comments), complete (no object omitted → not an impoverished strawman, spec Req 3).
    return rows.map((r) => `${r.sql.trim()};`).join('\n\n');
  } finally {
    db.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pinned prompt templates (design §Run protocol — verbatim framing; only schema access differs).
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_FRAMING = `You are answering ONE database-schema question. Reason as needed, then end your reply with a single
final line in EXACTLY this form:
ANSWER: <value>
where <value> follows the answer-format spec given below. Output nothing after that line.`;

const WITH_SCHEMA_ACCESS = `You have a dbgraph-indexed graph of the target database in your working directory. Use ONLY the
read-only dbgraph CLI to inspect the schema:
  dbgraph query "<term>" --json
  dbgraph explore "<qname>" --detail full
  dbgraph affected "<script.sql>" --json
  dbgraph status
Do NOT open, cat, or read any .sql / DDL / schema file directly — use the tool. The tool issues only
read-only catalog SELECTs; you must not attempt any write.`;

/** Byte-identical prefix across the pair (framing + question + answer-format spec). */
function sharedPrefix(q: QuestionRecord): string {
  return `${SYSTEM_FRAMING}\n\nQUESTION: ${q.question}\nANSWER FORMAT: ${q.answerFormat}\n`;
}

function withPacket(q: QuestionRecord): string {
  return `${sharedPrefix(q)}\n${WITH_SCHEMA_ACCESS}\n`;
}

function withoutPacket(q: QuestionRecord, ddlDump: string): string {
  return `${sharedPrefix(q)}\nHere is the database schema (DDL dump). You have no other tools for inspecting the database:\n${ddlDump}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground-truth ANSWER-value atoms (the pre-formatted answer that MUST NOT be embedded).
// Derived from the committed keys with the SAME shapes the scorer expects. Bare schema
// identifiers are intentionally NOT forbidden — the WITHOUT DDL is SUPPOSED to contain them;
// only the composed ANSWER value (what follows `ANSWER:`) is a leak.
// ─────────────────────────────────────────────────────────────────────────────

interface FkJc {
  readonly fromColumn: string;
  readonly toColumn: string;
}
interface FkHopGt {
  readonly fromTable: string;
  readonly toTable: string;
  readonly joinColumns: readonly FkJc[];
}
interface TriggerGt {
  readonly triggerQname: string;
  readonly timing: string;
  readonly events: readonly string[];
}

function answerAtoms(family: Family, gt: Record<string, unknown>): string[] {
  switch (family) {
    case 'fk-path': {
      const hops = (gt['hops'] ?? []) as readonly FkHopGt[];
      const atoms = hops.flatMap((h) =>
        h.joinColumns.map((jc) => `${h.fromTable}.${jc.fromColumn}=${h.toTable}.${jc.toColumn}`),
      );
      return [...atoms, atoms.join('; ')];
    }
    case 'column-type': {
      const dataType = String(gt['dataType'] ?? '');
      const nullable = Boolean(gt['nullable']);
      return [`${dataType}|${nullable ? 'NULL' : 'NOT NULL'}`];
    }
    case 'impact': {
      const names = ((gt['whatToTest'] ?? []) as readonly string[]).slice().sort();
      return [names.join(', ')];
    }
    case 'trigger-inventory': {
      const triggers = (gt['triggers'] ?? []) as readonly TriggerGt[];
      const atoms = triggers.map(
        (t) => `${t.triggerQname}:${t.timing}:${[...t.events].sort().join('|')}`,
      );
      return [...atoms, atoms.join(', ')];
    }
    case 'view-dependency': {
      const deps = ((gt['dependencies'] ?? []) as readonly string[]).slice().sort();
      return [deps.join(', ')];
    }
    case 'constraint-semantics': {
      const cols = (gt['columns'] ?? []) as readonly string[];
      return [cols.join(', ')];
    }
    case 'plan-callers': {
      const callers = ((gt['callers'] ?? []) as readonly string[]).slice().sort();
      return [callers.join(', ')];
    }
    case 'plan-blindspots': {
      const blindSpots = ((gt['blind_spots'] ?? []) as readonly string[]).slice().sort();
      return [blindSpots.join(', ')];
    }
    case 'plan-order': {
      // The composed answer is an ORDERING of the scoped set; the scope names themselves live in
      // the served scope block (excluded from the leak scan), so the composed atom is what to guard.
      const scope = (gt['scope'] ?? []) as readonly string[];
      return [scope.join(', ')];
    }
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-checks (task 3.3 — fail LOUDLY)
// ─────────────────────────────────────────────────────────────────────────────

const CREATE_STMT_RE = /CREATE\s+(TABLE|VIEW|TRIGGER|INDEX)\b/i;

function assertPacketPair(
  qid: string,
  family: Family,
  withText: string,
  withoutText: string,
  ddlDump: string,
  gt: Record<string, unknown>,
): void {
  // Structural: WITH exposes the CLI, carries NO DDL.
  if (!withText.includes('read-only dbgraph CLI')) {
    throw new Error(`SELF-CHECK FAILED: ${qid} WITH packet is missing the dbgraph CLI doc block.`);
  }
  if (withText.includes(ddlDump) || CREATE_STMT_RE.test(withText)) {
    throw new Error(`SELF-CHECK FAILED: ${qid} WITH packet contains DDL (it must not, D11).`);
  }
  // Structural: WITHOUT carries the DDL dump, NO tool docs.
  if (!withoutText.includes(ddlDump)) {
    throw new Error(`SELF-CHECK FAILED: ${qid} WITHOUT packet is missing the DDL dump.`);
  }
  if (withoutText.includes('read-only dbgraph CLI') || withoutText.includes('dbgraph query')) {
    throw new Error(`SELF-CHECK FAILED: ${qid} WITHOUT packet contains tool docs (it must not, D8).`);
  }
  // Answer-leak: no composed ANSWER value in EITHER packet. The DDL region is fair input the agent
  // must still read and reason over, so it is EXCLUDED from the scan — only an answer pasted
  // OUTSIDE the schema section (framing/question/format/tool-docs) would trip this.
  const atoms = answerAtoms(family, gt).filter((a) => a.trim().length > 0);
  for (const [label, text] of [
    ['WITH', withText],
    ['WITHOUT', withoutText],
  ] as const) {
    // The DDL region is fair input (excluded); r2 ALSO excludes a served SCOPE block via the SAME
    // shared helper generate uses — never a second hand-copied pattern. No markers ⇒ unchanged.
    const scannable = excludeScopeBlock(text.split(ddlDump).join(''));
    for (const atom of atoms) {
      if (scannable.includes(atom)) {
        throw new Error(
          `SELF-CHECK FAILED: ${qid} ${label} packet embeds the ANSWER value "${atom}" outside the schema section (D5/D12 leak guard).`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(benchmarkDir);
const substrate = args['substrate'] !== undefined ? String(args['substrate']) : 'sqlite-torture';

const questionsPath =
  args['questions'] !== undefined ? resolve(args['questions']) : join(benchmarkDir, 'questions.yaml');
const groundTruthDir =
  args['ground-truth'] !== undefined ? resolve(args['ground-truth']) : join(benchmarkDir, 'ground-truth');
const outDir = args['out'] !== undefined ? resolve(args['out']) : join(benchmarkDir, 'packets');
const dbPath = args['db'] !== undefined ? resolve(args['db']) : '';

if (!existsSync(questionsPath)) {
  throw new Error(`build-packets: questions.yaml not found at ${questionsPath}. Run generate.ts first.`);
}

const questions = parseQuestionsYaml(readFileSync(questionsPath, 'utf8'));
if (questions.length === 0) {
  throw new Error('build-packets: no questions parsed from questions.yaml (empty pre-registered set?).');
}

// The WITHOUT DDL dump. Default `sqlite-torture` (byte-identical): the comment-free `sqlite_master`
// dump from --db. `mssql-torture` (D5): the deterministic comment/header/GO-stripped torture.sql,
// SP bodies verbatim — no store, no --db needed.
let ddlDump: string;
if (substrate === 'mssql-torture') {
  const mssqlDdlPath =
    args['ddl'] !== undefined ? resolve(args['ddl']) : join(repoRoot, 'test', 'fixtures', 'mssql', 'torture.sql');
  if (!existsSync(mssqlDdlPath)) {
    throw new Error(`build-packets --substrate mssql-torture: mssql fixture not found at ${mssqlDdlPath}.`);
  }
  ddlDump = stripMssqlDdl(readFileSync(mssqlDdlPath, 'utf8'));
} else {
  if (dbPath === '' || !existsSync(dbPath)) {
    throw new Error(
      'build-packets: --db <target-sqlite.db> is required (the indexed database, for the sqlite_master DDL dump). ' +
        'Build it from the committed fixture first (materialize test/fixtures/sqlite/torture.sql).',
    );
  }
  ddlDump = buildDdlDump(dbPath);
}
const withoutTokens: TokenCount = schemaTokens({ schemaText: ddlDump });

mkdirSync(outDir, { recursive: true });

interface ManifestEntry {
  readonly qid: string;
  readonly family: Family;
  readonly condition: 'with' | 'without';
  readonly promptSha256: string;
  /** WITHOUT: schema-tokens of the DDL dump (D9). WITH: null — counted from tool outputs at run time. */
  readonly schemaTokens: TokenCount | null;
  /** ADDITIVE substrate label (spec Req 4). OMITTED on the frozen `sqlite-torture` default so the
   * committed sqlite manifest stays BYTE-IDENTICAL; present only for a non-default substrate. */
  readonly substrate?: string;
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The substrate label to thread into a manifest entry — `{}` on the sqlite default (byte-identical). */
const substrateField: { substrate?: string } = substrate === 'sqlite-torture' ? {} : { substrate };

const manifest: ManifestEntry[] = [];
for (const q of questions) {
  const gt = JSON.parse(readFileSync(join(groundTruthDir, `${q.qid}.json`), 'utf8')) as Record<string, unknown>;
  const withText = withPacket(q);
  const withoutText = withoutPacket(q, ddlDump);

  assertPacketPair(q.qid, q.family, withText, withoutText, ddlDump, gt);

  // Build-time DDL-coverage assertion (spec Req 1): every derived target object MUST be DEFINED
  // in the WITHOUT dump. A miss (e.g. a dump from the WRONG database) aborts LOUDLY with exit 1.
  // The message names only `KIND bare-identifier` — already present un-redacted in a correct dump
  // — NEVER a composed answer value (leak guard). The pure decisions live in harness-checks.ts.
  const missing = verifyDumpCoverage(ddlDump, deriveCoverageTargets(q.qid, q.family, gt));
  if (missing.length > 0) {
    const objects = missing.map((m) => `${m.kind.toUpperCase()} ${m.name}`).join(', ');
    throw new Error(
      `SELF-CHECK FAILED: ${q.qid} (${q.family}) — DDL dump does not define target object(s): ${objects}`,
    );
  }

  writeFileSync(join(outDir, `${q.qid}.with.md`), withText);
  writeFileSync(join(outDir, `${q.qid}.without.md`), withoutText);

  manifest.push({
    qid: q.qid,
    family: q.family,
    condition: 'with',
    promptSha256: sha256(withText),
    schemaTokens: null,
    ...substrateField,
  });
  manifest.push({
    qid: q.qid,
    family: q.family,
    condition: 'without',
    promptSha256: sha256(withoutText),
    schemaTokens: withoutTokens,
    ...substrateField,
  });
}

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(
  `build-packets: ${questions.length} question(s) → ${questions.length * 2} packets in ${outDir}\n`,
);
process.stdout.write(
  `  WITHOUT schema-tokens (DDL dump, ${withoutTokens.mode}): ${withoutTokens.schemaTokens}\n`,
);
for (const q of questions) process.stdout.write(`  ${q.qid}.{with,without}.md\n`);
