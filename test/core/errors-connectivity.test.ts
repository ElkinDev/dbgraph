/**
 * Tests for ConnectivityOption, ConnectivityOutcome, ConnectivityUnavailableError —
 * task 1.2 (resilient-connectivity Batch 1).
 *
 * Spec: connectivity-diagnostics "Connection failure yields a typed non-blocking outcome
 *   presenting at least three options".
 * Design: ConnectivityOption discriminated union + ConnectivityOutcome interface +
 *   ConnectivityUnavailableError extending DbgraphError (E_CONNECTIVITY_UNAVAILABLE).
 *
 * Invariants asserted here:
 *   - instanceof DbgraphError is TRUE
 *   - code === 'E_CONNECTIVITY_UNAVAILABLE'
 *   - name === 'ConnectivityUnavailableError'
 *   - outcome.options.length >= 3 for a constructed sample
 *   - the message carries outcome.summary (content-free, no identifier)
 *   - StrategyExhaustionError / ConnectionError / PermissionError are UNCHANGED
 *
 * TDD: RED → GREEN.
 * EXACT-set assertions (L-009): full option-kind set asserted, not existence-only.
 */

import { describe, it, expect } from 'vitest';
import {
  DbgraphError,
  StrategyExhaustionError,
  ConnectionError,
  PermissionError,
  ConnectivityUnavailableError,
} from '../../src/core/errors.js';
import type {
  ConnectivityOption,
  ConnectivityOutcome,
} from '../../src/core/errors.js';
import type { StrategyAttempt } from '../../src/core/ports/connectivity-strategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_ATTEMPTS: readonly StrategyAttempt[] = [
  { id: 'native-tedious', reason: 'tedious not installed' },
  { id: 'sqlcmd', reason: 'sqlcmd not on PATH' },
  { id: 'manual-dump', reason: 'dump file not present' },
];

const RUN_IT_YOURSELF_OPTION: ConnectivityOption = {
  kind: 'run-it-yourself',
  description: 'Run these SELECT statements in your own client and share the output.',
  queries: [
    "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
    "SELECT table_name FROM information_schema.tables ORDER BY table_name",
    "SELECT column_name FROM information_schema.columns ORDER BY ordinal_position",
  ],
};

const CONSENTED_INSTALL_OPTION: ConnectivityOption = {
  kind: 'consented-install',
  description: 'Install the missing driver package (requires explicit consent).',
  tool: 'tedious',
  docUrl: 'https://www.npmjs.com/package/tedious',
};

const MANUAL_DUMP_OPTION: ConnectivityOption = {
  kind: 'manual-dump',
  description: 'Import a JSON dump of your schema produced externally.',
  outputPath: '.dbgraph/dumps/mssql-dump.json',
};

function buildSampleOutcome(): ConnectivityOutcome {
  return {
    engine: 'mssql',
    summary: 'No connectivity method available for engine "mssql".',
    attempts: SAMPLE_ATTEMPTS,
    options: [RUN_IT_YOURSELF_OPTION, CONSENTED_INSTALL_OPTION, MANUAL_DUMP_OPTION],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectivityOption discriminated union — shape assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectivityOption — run-it-yourself', () => {
  it('carries kind, description, and readonly queries array', () => {
    const opt = RUN_IT_YOURSELF_OPTION;
    expect(opt.kind).toBe('run-it-yourself');
    expect(opt.description).toBeTruthy();
    expect(Array.isArray(opt.queries)).toBe(true);
    expect(opt.queries.length).toBeGreaterThanOrEqual(1);
  });

  it('queries contain no write verb (SELECT-only)', () => {
    const writeVerbs = /INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE/i;
    for (const q of RUN_IT_YOURSELF_OPTION.queries) {
      expect(q).not.toMatch(writeVerbs);
    }
  });
});

describe('ConnectivityOption — consented-install', () => {
  it('carries kind, description, tool, and docUrl', () => {
    const opt = CONSENTED_INSTALL_OPTION;
    expect(opt.kind).toBe('consented-install');
    expect(opt.description).toBeTruthy();
    expect(opt.tool).toBeTruthy();
    expect(opt.docUrl).toBeTruthy();
  });
});

describe('ConnectivityOption — manual-dump', () => {
  it('carries kind, description, and outputPath', () => {
    const opt = MANUAL_DUMP_OPTION;
    expect(opt.kind).toBe('manual-dump');
    expect(opt.description).toBeTruthy();
    expect(opt.outputPath).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConnectivityOutcome interface — shape assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectivityOutcome', () => {
  it('carries engine, summary, attempts, and options', () => {
    const outcome = buildSampleOutcome();
    expect(outcome.engine).toBe('mssql');
    expect(typeof outcome.summary).toBe('string');
    expect(Array.isArray(outcome.attempts)).toBe(true);
    expect(Array.isArray(outcome.options)).toBe(true);
  });

  it('options.length >= 3 (EXACT-set: all three option kinds)', () => {
    const outcome = buildSampleOutcome();
    expect(outcome.options.length).toBeGreaterThanOrEqual(3);
    const kinds = outcome.options.map((o) => o.kind);
    expect(kinds).toContain('run-it-yourself');
    expect(kinds).toContain('consented-install');
    expect(kinds).toContain('manual-dump');
  });

  it('EXACT-set: options array equals the three expected kinds in order', () => {
    const outcome = buildSampleOutcome();
    expect(outcome.options.map((o) => o.kind)).toEqual([
      'run-it-yourself',
      'consented-install',
      'manual-dump',
    ]);
  });

  it('attempts carries each strategy id and reason', () => {
    const outcome = buildSampleOutcome();
    expect(outcome.attempts).toHaveLength(3);
    expect(outcome.attempts[0]?.id).toBe('native-tedious');
    expect(outcome.attempts[1]?.reason).toBe('sqlcmd not on PATH');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConnectivityUnavailableError
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectivityUnavailableError', () => {
  const outcome = buildSampleOutcome();
  const err = new ConnectivityUnavailableError(outcome);

  it('is an instance of Error', () => {
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of DbgraphError', () => {
    expect(err).toBeInstanceOf(DbgraphError);
  });

  it('is an instance of ConnectivityUnavailableError', () => {
    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('carries stable code E_CONNECTIVITY_UNAVAILABLE', () => {
    expect(err.code).toBe('E_CONNECTIVITY_UNAVAILABLE');
  });

  it('name is ConnectivityUnavailableError', () => {
    expect(err.name).toBe('ConnectivityUnavailableError');
  });

  it('carries the outcome as a readonly property', () => {
    expect(err.outcome).toBe(outcome);
  });

  it('outcome round-trips the full options array', () => {
    expect(err.outcome.options).toHaveLength(3);
    expect(err.outcome.options.map((o) => o.kind)).toEqual([
      'run-it-yourself',
      'consented-install',
      'manual-dump',
    ]);
  });

  it('message carries outcome.summary (content-free)', () => {
    expect(err.message).toBe(outcome.summary);
  });

  it('message does not contain a schema/identifier string injected into the summary', () => {
    // summary must be content-free — no schema names, object identifiers
    const forbiddenIdentifiers = ['dbo.orders', 'information_schema.tables', 'sys.objects'];
    for (const id of forbiddenIdentifiers) {
      expect(err.message).not.toContain(id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: existing error classes are UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────

describe('StrategyExhaustionError — unchanged', () => {
  const attempts: StrategyAttempt[] = [
    { id: 'native-tedious', reason: 'not installed' },
    { id: 'sqlcmd', reason: 'not on PATH' },
  ];

  it('still extends DbgraphError with code E_STRATEGY_EXHAUSTION', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_STRATEGY_EXHAUSTION');
    expect(err.name).toBe('StrategyExhaustionError');
  });

  it('still carries the attempts array', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.attempts).toBe(attempts);
  });
});

describe('ConnectionError — unchanged', () => {
  it('still extends DbgraphError with code E_CONNECTION', () => {
    const err = new ConnectionError('driver not installed');
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_CONNECTION');
  });
});

describe('PermissionError — unchanged', () => {
  it('still extends DbgraphError with code E_PERMISSION', () => {
    const err = new PermissionError('read-only connection');
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_PERMISSION');
  });
});
