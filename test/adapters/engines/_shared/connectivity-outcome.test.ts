/**
 * connectivity-outcome.test.ts — unit tests for buildConnectivityOutcome.
 *
 * Task 3.1 (resilient-connectivity Batch 3).
 * Spec: connectivity-diagnostics "the SAME three options for any engine;
 *   run-it-yourself carries write-verb-free catalog SELECTs".
 * Design: engine-agnostic builder produces the IDENTICAL 3-option shape for every
 *   engine — pg/mysql driver-absent and mssql strategy-exhaustion call the SAME fn.
 *
 * EXACT-set assertions (L-009): options.length === 3, kinds in order, queries verbatim.
 * Write-verb scanner: no INSERT/UPDATE/DELETE/MERGE/CREATE/ALTER/DROP/TRUNCATE in queries.
 *
 * TDD: RED→GREEN→refactor.
 */

import { describe, it, expect } from 'vitest';
import { buildConnectivityOutcome } from '../../../../src/adapters/engines/_shared/connectivity-outcome.js';

// ─────────────────────────────────────────────────────────────────────────────
// Sample catalog SELECTs (write-verb-free — would fail scanner if they had verbs)
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_QUERIES = [
  'SELECT name FROM sys.schemas WHERE is_ms_shipped = 0 ORDER BY name',
  'SELECT schema_name, table_name FROM information_schema.tables',
];

const SAMPLE_ARGS = {
  engine: 'pg',
  summary: 'No connection method available',
  attempts: [],
  runItYourselfQueries: SAMPLE_QUERIES,
  installTool: 'pg',
  installDocUrl: 'https://www.npmjs.com/package/pg',
  dumpPath: '.dbgraph/dumps/pg-dump.json',
};

// ─────────────────────────────────────────────────────────────────────────────
// 3.1 — shape assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConnectivityOutcome()', () => {
  it('returns a ConnectivityOutcome with the given engine', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    expect(outcome.engine).toBe('pg');
  });

  it('returns the given summary', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    expect(outcome.summary).toBe('No connection method available');
  });

  it('returns the given attempts array', () => {
    const attempts = [{ id: 'native-tedious', reason: 'integrated auth skipped' }];
    const outcome = buildConnectivityOutcome({ ...SAMPLE_ARGS, attempts });
    expect(outcome.attempts).toEqual(attempts);
  });

  // ── EXACT-set: exactly 3 options in correct kind order ─────────────────────

  it('returns exactly 3 options', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    expect(outcome.options.length).toBe(3);
  });

  it('option[0] kind is "run-it-yourself"', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    expect(outcome.options[0]?.kind).toBe('run-it-yourself');
  });

  it('option[1] kind is "consented-install"', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    expect(outcome.options[1]?.kind).toBe('consented-install');
  });

  it('option[2] kind is "manual-dump"', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    expect(outcome.options[2]?.kind).toBe('manual-dump');
  });

  it('option kinds array equals exactly ["run-it-yourself","consented-install","manual-dump"]', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    expect(outcome.options.map((o) => o.kind)).toEqual([
      'run-it-yourself',
      'consented-install',
      'manual-dump',
    ]);
  });

  // ── run-it-yourself carries the exact passed queries ──────────────────────

  it('run-it-yourself option queries equals the passed runItYourselfQueries', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    const opt = outcome.options[0];
    if (opt?.kind !== 'run-it-yourself') throw new Error('wrong kind');
    expect(opt.queries).toEqual(SAMPLE_QUERIES);
  });

  // ── consented-install carries tool + docUrl ────────────────────────────────

  it('consented-install option carries tool name', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    const opt = outcome.options[1];
    if (opt?.kind !== 'consented-install') throw new Error('wrong kind');
    expect(opt.tool).toBe('pg');
  });

  it('consented-install option carries docUrl', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    const opt = outcome.options[1];
    if (opt?.kind !== 'consented-install') throw new Error('wrong kind');
    expect(opt.docUrl).toBe('https://www.npmjs.com/package/pg');
  });

  // ── manual-dump carries outputPath ────────────────────────────────────────

  it('manual-dump option carries the dump path', () => {
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    const opt = outcome.options[2];
    if (opt?.kind !== 'manual-dump') throw new Error('wrong kind');
    expect(opt.outputPath).toBe('.dbgraph/dumps/pg-dump.json');
  });

  // ── Write-verb scanner over run-it-yourself queries ────────────────────────

  it('run-it-yourself queries contain no write verbs (INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)', () => {
    const writeVerbPattern = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i;
    const outcome = buildConnectivityOutcome(SAMPLE_ARGS);
    const opt = outcome.options[0];
    if (opt?.kind !== 'run-it-yourself') throw new Error('wrong kind');
    for (const query of opt.queries) {
      expect(query).not.toMatch(writeVerbPattern);
    }
  });

  // ── Mutation check: outcome.options carries only 3 entries even with different engines ──

  it('produces 3 options for mssql engine', () => {
    const outcome = buildConnectivityOutcome({
      ...SAMPLE_ARGS,
      engine: 'mssql',
      installTool: 'sqlcmd',
    });
    expect(outcome.options.length).toBe(3);
    expect(outcome.options.map((o) => o.kind)).toEqual([
      'run-it-yourself',
      'consented-install',
      'manual-dump',
    ]);
  });

  it('produces 3 options for mysql engine', () => {
    const outcome = buildConnectivityOutcome({
      ...SAMPLE_ARGS,
      engine: 'mysql',
      installTool: 'mysql2',
    });
    expect(outcome.options.length).toBe(3);
    expect(outcome.options.map((o) => o.kind)).toEqual([
      'run-it-yourself',
      'consented-install',
      'manual-dump',
    ]);
  });
});
