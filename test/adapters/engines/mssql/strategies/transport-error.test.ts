/**
 * transport-error.test.ts — C2 remediation (R1): TransportError (E_TRANSPORT).
 *
 * Spec (connectivity MODIFIED): "a transport/format/parse failure is redacted into
 *   a typed error" — TransportError with code E_TRANSPORT and a REDACTED message.
 *   No raw stderr / host / identifier must appear in the thrown error.
 *
 * RED tests written first (TDD). They fail until:
 *   1. TransportError is added to src/core/errors.ts (+ exported from core/index.ts).
 *   2. reassembleForJson / reassembleSingleForJson throw TransportError on malformed input.
 *   3. SqlcmdStrategy.runCatalog() + fingerprint() wrap spawn/transport failures in TransportError.
 *
 * Planted values prove REDACTION: the raw stderr / error message contains the
 * planted secret; the TransportError.message must NOT.
 */

import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { reassembleForJson, reassembleSingleForJson } from '../../../../../src/adapters/engines/mssql/strategies/json-rows.js';
import { SqlcmdStrategy, type SpawnSyncFn } from '../../../../../src/adapters/engines/mssql/strategies/sqlcmd.strategy.js';
import type { SqlcmdProfile } from '../../../../../src/adapters/engines/mssql/strategies/profiles.js';
import type { MssqlAdapterConfig } from '../../../../../src/core/ports/schema-adapter.js';
import { DEFAULT_LEVELS } from '../../../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<SqlcmdProfile> = {}): SqlcmdProfile {
  return {
    variant: 'legacy-odbc',
    versionRange: '15.x',
    flags: ['-y', '0', '-f', 'o:65001'],
    outputShape: { chunkSize: 2033, hasHeader: false },
    encoding: 'utf8',
    ...overrides,
  };
}

/** Makes a minimal SpawnSyncReturns<Buffer> result. */
function makeSpawnResult(
  overrides: Partial<Omit<SpawnSyncReturns<Buffer>, 'error'>> & { error?: Error } = {},
): SpawnSyncReturns<Buffer> {
  const base: SpawnSyncReturns<Buffer> = {
    pid: 1,
    output: [],
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    status: 0,
    signal: null,
    ...overrides,
  };
  if (overrides.error !== undefined) {
    base.error = overrides.error;
  }
  return base;
}

const MINIMAL_MSSQL_CONFIG: MssqlAdapterConfig = {
  server: 'TESTSERVER',
  database: 'TestDb',
  authentication: { type: 'integrated' },
};

const PLANTED_SECRET = 'p@ssw0rd!Xk92_server=prod-sql.internal.company.com';
const PLANTED_HOST = 'prod-sql.internal.company.com';

// ─────────────────────────────────────────────────────────────────────────────
// C2: reassembleForJson must throw TransportError on malformed JSON
// ─────────────────────────────────────────────────────────────────────────────

describe('C2 — reassembleForJson throws TransportError on malformed JSON', () => {
  it('throws on malformed JSON output (invalid input string)', () => {
    const reallyMalformed = Buffer.from('not json at all\r\n', 'utf8');
    const profile = makeProfile();

    expect(() => reassembleForJson(reallyMalformed, profile)).toThrow();
  });

  it('thrown error has code E_TRANSPORT', () => {
    const malformedBuf = Buffer.from('{broken json\r\n', 'utf8');
    const profile = makeProfile();

    let thrown: unknown;
    try {
      reassembleForJson(malformedBuf, profile);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    // After fix: must be a TransportError with code E_TRANSPORT
    expect((thrown as { code?: string }).code).toBe('E_TRANSPORT');
  });

  it('TransportError message does NOT contain raw output content (redacted)', () => {
    // Plant a "secret" in the malformed output — it must not appear in the error message
    const malformedWithSecret = Buffer.from(
      `{broken json with ${PLANTED_SECRET}\r\n`,
      'utf8',
    );
    const profile = makeProfile();

    let thrown: unknown;
    try {
      reassembleForJson(malformedWithSecret, profile);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    const msg = (thrown as Error).message;
    // The error message must NOT echo back the planted secret
    expect(msg).not.toContain(PLANTED_SECRET);
  });

  it('thrown error is an instance of the TransportError class', async () => {
    // Dynamic import so this test file compiles before TransportError exists
    // (will fail at runtime until C2 is implemented — that is the RED state)
    const { TransportError } = await import('../../../../../src/core/errors.js');

    const malformedBuf = Buffer.from('{broken\r\n', 'utf8');
    const profile = makeProfile();

    let thrown: unknown;
    try {
      reassembleForJson(malformedBuf, profile);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(TransportError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2: reassembleSingleForJson must throw TransportError on malformed JSON
// ─────────────────────────────────────────────────────────────────────────────

describe('C2 — reassembleSingleForJson throws TransportError on malformed JSON', () => {
  it('thrown error has code E_TRANSPORT for malformed WITHOUT_ARRAY_WRAPPER output', () => {
    const malformedBuf = Buffer.from('{broken json\r\n', 'utf8');
    const profile = makeProfile();

    let thrown: unknown;
    try {
      reassembleSingleForJson(malformedBuf, profile);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe('E_TRANSPORT');
  });

  it('TransportError message for single-object does NOT contain raw output content', () => {
    const malformedWithSecret = Buffer.from(
      `{broken with ${PLANTED_SECRET}\r\n`,
      'utf8',
    );
    const profile = makeProfile();

    let thrown: unknown;
    try {
      reassembleSingleForJson(malformedWithSecret, profile);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    const msg = (thrown as Error).message;
    expect(msg).not.toContain(PLANTED_SECRET);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2: SqlcmdStrategy.runCatalog() spawn failure must throw TransportError
// ─────────────────────────────────────────────────────────────────────────────

describe('C2 — SqlcmdStrategy.runCatalog() spawn failure throws TransportError', () => {
  it('thrown error has code E_TRANSPORT when sqlcmd exits non-zero', async () => {
    // Simulate a spawn that "worked" (no .error) but exited with status 1
    // and produced stderr containing a planted secret/host identifier.
    const stderrWithSecret = Buffer.from(
      `Sqlcmd: Error: Microsoft ODBC Driver... server=${PLANTED_HOST} user=sa password=${PLANTED_SECRET}`,
      'utf8',
    );

    let callIdx = 0;
    const mockSpawn: SpawnSyncFn = () => {
      const idx = callIdx++;
      if (idx === 0) {
        // detect(): where sqlcmd → available
        return makeSpawnResult({ status: 0, stdout: Buffer.from('sqlcmd\n') });
      }
      if (idx === 1) {
        // canConnect(): SELECT 1 → ok
        return makeSpawnResult({ status: 0 });
      }
      // runCatalog: first family fails with non-zero exit + planted stderr
      return makeSpawnResult({ status: 1, stderr: stderrWithSecret });
    };

    const strategy = new SqlcmdStrategy(MINIMAL_MSSQL_CONFIG, mockSpawn);
    // Bypass detect/canConnect — call runCatalog directly after wiring detect
    // We cannot call detect (it's async + returns bool); call runCatalog directly.
    let thrown: unknown;
    try {
      await strategy.runCatalog({ levels: DEFAULT_LEVELS });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe('E_TRANSPORT');
  });

  it('TransportError from runCatalog does NOT contain planted stderr content', async () => {
    const stderrWithSecret = Buffer.from(
      `server=${PLANTED_HOST} secret=${PLANTED_SECRET}`,
      'utf8',
    );

    let callIdx = 0;
    const mockSpawn: SpawnSyncFn = () => {
      const idx = callIdx++;
      if (idx === 0) return makeSpawnResult({ status: 0, stdout: Buffer.from('sqlcmd\n') });
      if (idx === 1) return makeSpawnResult({ status: 0 });
      return makeSpawnResult({ status: 1, stderr: stderrWithSecret });
    };

    const strategy = new SqlcmdStrategy(MINIMAL_MSSQL_CONFIG, mockSpawn);
    let thrown: unknown;
    try {
      await strategy.runCatalog({ levels: DEFAULT_LEVELS });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    const msg = (thrown as Error).message;
    expect(msg).not.toContain(PLANTED_HOST);
    expect(msg).not.toContain(PLANTED_SECRET);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2: SqlcmdStrategy.fingerprint() spawn failure must throw TransportError
// ─────────────────────────────────────────────────────────────────────────────

describe('C2 — SqlcmdStrategy.fingerprint() spawn failure throws TransportError', () => {
  it('thrown error has code E_TRANSPORT when fingerprint sqlcmd exits non-zero', async () => {
    const stderrWithSecret = Buffer.from(
      `Sqlcmd: Error: server=${PLANTED_HOST} secret=${PLANTED_SECRET}`,
      'utf8',
    );

    const mockSpawn: SpawnSyncFn = () => {
      return makeSpawnResult({ status: 1, stderr: stderrWithSecret });
    };

    const strategy = new SqlcmdStrategy(MINIMAL_MSSQL_CONFIG, mockSpawn);
    let thrown: unknown;
    try {
      await strategy.fingerprint();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe('E_TRANSPORT');
  });

  it('TransportError from fingerprint does NOT contain planted stderr content', async () => {
    const stderrWithSecret = Buffer.from(
      `server=${PLANTED_HOST} secret=${PLANTED_SECRET}`,
      'utf8',
    );

    const mockSpawn: SpawnSyncFn = () => {
      return makeSpawnResult({ status: 1, stderr: stderrWithSecret });
    };

    const strategy = new SqlcmdStrategy(MINIMAL_MSSQL_CONFIG, mockSpawn);
    let thrown: unknown;
    try {
      await strategy.fingerprint();
    } catch (e) {
      thrown = e;
    }

    const msg = (thrown as Error).message;
    expect(msg).not.toContain(PLANTED_HOST);
    expect(msg).not.toContain(PLANTED_SECRET);
  });
});
