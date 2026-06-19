/**
 * parity.test.ts — engine-agnostic parity suite.
 *
 * Task 3.5 (resilient-connectivity Batch 3).
 * Spec: connectivity-diagnostics "the SAME three options whether pg/mysql (driver absent)
 *   or mssql (strategy chain exhausted)".
 * Design: the parity is PROVEN by construction (all three engines call the SAME
 *   `buildConnectivityOutcome` function), not asserted by inspection.
 *
 * This suite drives a pg driver-absent outcome (via the 3.2 path),
 * a mysql driver-absent outcome (3.3), AND an mssql strategy-exhaustion outcome (3.4),
 * then asserts all three yield the SAME ≥3-option shape.
 *
 * EXACT-set assertions (L-009): option kinds equal exactly the canonical order,
 *   length === 3, run-it-yourself write-verb-free.
 */

import { describe, it, expect } from 'vitest';
import { createPgSchemaAdapter } from '../../../../src/adapters/engines/pg/factory.js';
import { createMysqlSchemaAdapter } from '../../../../src/adapters/engines/mysql/factory.js';
import { selectStrategy } from '../../../../src/adapters/engines/mssql/strategies/registry.js';
import {
  ConnectivityUnavailableError,
} from '../../../../src/core/errors.js';
import type { ConnectivityStrategy, DetectResult } from '../../../../src/core/ports/connectivity-strategy.js';
import { noopLogger } from '../../../../src/core/ports/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to drive each engine's failure path
// ─────────────────────────────────────────────────────────────────────────────

const PG_CONFIG = {
  host: 'localhost',
  database: 'testdb',
  user: 'user',
  password: 'pw',
} as const;

const MYSQL_CONFIG = {
  host: 'localhost',
  database: 'testdb',
  user: 'user',
  password: 'pw',
} as const;

function makeDriverAbsentPg(): Promise<ConnectivityUnavailableError> {
  return createPgSchemaAdapter(PG_CONFIG, {
    importPg: (): unknown => {
      throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
    },
  }).then(() => { throw new Error('should have thrown'); })
    .catch((e: unknown) => {
      if (e instanceof ConnectivityUnavailableError) return e;
      throw e;
    });
}

function makeDriverAbsentMysql(): Promise<ConnectivityUnavailableError> {
  return createMysqlSchemaAdapter(MYSQL_CONFIG, {
    importMysql: async (): Promise<unknown> => {
      throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
    },
  }).then(() => { throw new Error('should have thrown'); })
    .catch((e: unknown) => {
      if (e instanceof ConnectivityUnavailableError) return e;
      throw e;
    });
}

function makeAllSkippedMssql(): Promise<ConnectivityUnavailableError> {
  const skipAll: ConnectivityStrategy = {
    id: 'all-skipped',
    detect: async (): Promise<DetectResult> => ({
      available: false,
      detail: 'all strategies skipped in parity test',
    }),
    canConnect: async () => false,
    runCatalog: async () => { throw new Error('not reached'); },
    close: async () => undefined,
  };
  return selectStrategy([skipAll], noopLogger)
    .then(() => { throw new Error('should have thrown'); })
    .catch((e: unknown) => {
      if (e instanceof ConnectivityUnavailableError) return e;
      throw e;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// PARITY — the three outcomes must share the identical option-kind set
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_KINDS: readonly string[] = [
  'run-it-yourself',
  'consented-install',
  'manual-dump',
];

const WRITE_VERB_PATTERN = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i;

describe('Engine-agnostic parity — pg/mysql driver-absent AND mssql strategy-exhaustion (Batch 3, task 3.5)', () => {
  it('pg driver-absent yields ConnectivityUnavailableError', async () => {
    const err = await makeDriverAbsentPg();
    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('mysql driver-absent yields ConnectivityUnavailableError', async () => {
    const err = await makeDriverAbsentMysql();
    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('mssql strategy-exhaustion yields ConnectivityUnavailableError', async () => {
    const err = await makeAllSkippedMssql();
    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('pg: options.length === 3', async () => {
    const err = await makeDriverAbsentPg();
    expect(err.outcome.options.length).toBe(3);
  });

  it('mysql: options.length === 3', async () => {
    const err = await makeDriverAbsentMysql();
    expect(err.outcome.options.length).toBe(3);
  });

  it('mssql: options.length === 3', async () => {
    const err = await makeAllSkippedMssql();
    expect(err.outcome.options.length).toBe(3);
  });

  it('pg: option kinds equal exactly the canonical order', async () => {
    const err = await makeDriverAbsentPg();
    expect(err.outcome.options.map((o) => o.kind)).toEqual(EXPECTED_KINDS);
  });

  it('mysql: option kinds equal exactly the canonical order', async () => {
    const err = await makeDriverAbsentMysql();
    expect(err.outcome.options.map((o) => o.kind)).toEqual(EXPECTED_KINDS);
  });

  it('mssql: option kinds equal exactly the canonical order', async () => {
    const err = await makeAllSkippedMssql();
    expect(err.outcome.options.map((o) => o.kind)).toEqual(EXPECTED_KINDS);
  });

  it('PARITY PROOF: all three outcomes share identical option-kind sets', async () => {
    const [pgErr, mysqlErr, mssqlErr] = await Promise.all([
      makeDriverAbsentPg(),
      makeDriverAbsentMysql(),
      makeAllSkippedMssql(),
    ]);
    const pgKinds = pgErr.outcome.options.map((o) => o.kind);
    const mysqlKinds = mysqlErr.outcome.options.map((o) => o.kind);
    const mssqlKinds = mssqlErr.outcome.options.map((o) => o.kind);
    expect(pgKinds).toEqual(EXPECTED_KINDS);
    expect(mysqlKinds).toEqual(EXPECTED_KINDS);
    expect(mssqlKinds).toEqual(EXPECTED_KINDS);
    // All three are identical to each other
    expect(pgKinds).toEqual(mysqlKinds);
    expect(mysqlKinds).toEqual(mssqlKinds);
  });

  it('pg: run-it-yourself queries are write-verb-free', async () => {
    const err = await makeDriverAbsentPg();
    const riyo = err.outcome.options[0];
    if (riyo?.kind !== 'run-it-yourself') throw new Error('wrong kind');
    for (const query of riyo.queries) {
      expect(query).not.toMatch(WRITE_VERB_PATTERN);
    }
  });

  it('mysql: run-it-yourself queries are write-verb-free', async () => {
    const err = await makeDriverAbsentMysql();
    const riyo = err.outcome.options[0];
    if (riyo?.kind !== 'run-it-yourself') throw new Error('wrong kind');
    for (const query of riyo.queries) {
      expect(query).not.toMatch(WRITE_VERB_PATTERN);
    }
  });

  it('mssql: run-it-yourself queries are write-verb-free', async () => {
    const err = await makeAllSkippedMssql();
    const riyo = err.outcome.options[0];
    if (riyo?.kind !== 'run-it-yourself') throw new Error('wrong kind');
    for (const query of riyo.queries) {
      expect(query).not.toMatch(WRITE_VERB_PATTERN);
    }
  });
});
