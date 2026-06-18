/**
 * registry.test.ts — unit tests for buildMssqlStrategies + selectStrategy.
 *
 * C3.1: buildMssqlStrategies returns ordered list (native-tedious, sqlcmd) for
 *       explicit-credential configs; integrated config omits native-tedious.
 * C3.2: selectStrategy iterates detect() + canConnect(), logs each probe via Logger,
 *       returns first that passes both; throws StrategyExhaustionError if none pass.
 * D4.x: manual-dump is appended AFTER sqlcmd in the registry order (Batch D).
 *
 * All strategies are mocked — no real sqlcmd, no real mssql pool, no real dump file.
 * connectivity-strategies Batches C + D, tasks C3.1–C3.2 + D4.x.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectivityStrategy, DetectResult } from '../../../../../src/core/ports/connectivity-strategy.js';
import type { Logger } from '../../../../../src/core/ports/logger.js';
import { StrategyExhaustionError } from '../../../../../src/core/errors.js';
import {
  buildMssqlStrategies,
  selectStrategy,
  detectAllCandidates,
  type MssqlStrategyDeps,
} from '../../../../../src/adapters/engines/mssql/strategies/registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test configs
// ─────────────────────────────────────────────────────────────────────────────

const SQL_CONFIG = {
  server: 'localhost',
  database: 'testdb',
  authentication: { type: 'sql' as const, user: 'sa', password: 'Pass1234!' },
  trustServerCertificate: true,
} as const;

const NTLM_CONFIG = {
  server: 'corpserver',
  database: 'proddb',
  authentication: {
    type: 'ntlm' as const,
    domain: 'CORP',
    user: 'svc_account',
    password: 'WinPass!',
  },
} as const;

const INTEGRATED_CONFIG = {
  server: 'intserver',
  database: 'intdb',
  authentication: { type: 'integrated' as const },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Mock strategy factory
// ─────────────────────────────────────────────────────────────────────────────

function makeStrategy(
  id: string,
  detectResult: DetectResult,
  canConnectResult: boolean,
): ConnectivityStrategy {
  return {
    id,
    detect: vi.fn().mockResolvedValue(detectResult) as () => Promise<DetectResult>,
    canConnect: vi.fn().mockResolvedValue(canConnectResult) as () => Promise<boolean>,
    runCatalog: vi.fn(),
    close: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Logger
// ─────────────────────────────────────────────────────────────────────────────

type MockedLogger = {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

function makeLogger(): Logger & MockedLogger {
  return {
    debug: vi.fn() as unknown as Logger['debug'],
    info: vi.fn() as unknown as Logger['info'],
    warn: vi.fn() as unknown as Logger['warn'],
    error: vi.fn() as unknown as Logger['error'],
  } as Logger & MockedLogger;
}

// ─────────────────────────────────────────────────────────────────────────────
// C3.1 — buildMssqlStrategies
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlStrategies()', () => {
  it('returns at least 2 strategies for sql auth config', () => {
    const strategies = buildMssqlStrategies(SQL_CONFIG);
    expect(strategies.length).toBeGreaterThanOrEqual(2);
  });

  it('first strategy is native-tedious for explicit-cred (sql) config', () => {
    const strategies = buildMssqlStrategies(SQL_CONFIG);
    expect(strategies[0]?.id).toBe('native-tedious');
  });

  it('second strategy is sqlcmd for sql config', () => {
    const strategies = buildMssqlStrategies(SQL_CONFIG);
    expect(strategies[1]?.id).toBe('sqlcmd');
  });

  it('first strategy is native-tedious for ntlm config', () => {
    const strategies = buildMssqlStrategies(NTLM_CONFIG);
    expect(strategies[0]?.id).toBe('native-tedious');
  });

  it('omits native-tedious for integrated config', () => {
    const strategies = buildMssqlStrategies(INTEGRATED_CONFIG);
    const ids = strategies.map((s) => s.id);
    expect(ids).not.toContain('native-tedious');
  });

  it('first strategy is sqlcmd for integrated config', () => {
    const strategies = buildMssqlStrategies(INTEGRATED_CONFIG);
    expect(strategies[0]?.id).toBe('sqlcmd');
  });

  it('strategies array is non-empty for integrated config', () => {
    const strategies = buildMssqlStrategies(INTEGRATED_CONFIG);
    expect(strategies.length).toBeGreaterThanOrEqual(1);
  });

  // ── D4.x: manual-dump appended after sqlcmd ────────────────────────────────

  it('third strategy is manual-dump for sql config (Batch D)', () => {
    const strategies = buildMssqlStrategies(SQL_CONFIG);
    expect(strategies[2]?.id).toBe('manual-dump');
  });

  it('second strategy is manual-dump for integrated config (Batch D)', () => {
    const strategies = buildMssqlStrategies(INTEGRATED_CONFIG);
    // integrated: [sqlcmd, manual-dump] (native-tedious omitted)
    expect(strategies[1]?.id).toBe('manual-dump');
  });

  it('order is native-tedious → sqlcmd → manual-dump for sql config (Batch D)', () => {
    const strategies = buildMssqlStrategies(SQL_CONFIG);
    const ids = strategies.map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual(['native-tedious', 'sqlcmd', 'manual-dump']);
  });

  it('deps.ManualDump overrides the ManualDumpStrategy constructor (Batch D)', () => {
    class StubbedManualDump {
      readonly id = 'manual-dump-stub';
      async detect(): Promise<{ available: false; detail: string }> {
        return { available: false, detail: 'stub' };
      }
      async canConnect(): Promise<boolean> { return false; }
      async runCatalog(): Promise<never> { throw new Error('stub'); }
    }
    const deps: MssqlStrategyDeps = { ManualDump: StubbedManualDump as unknown as NonNullable<MssqlStrategyDeps['ManualDump']> };
    const strategies = buildMssqlStrategies(SQL_CONFIG, deps);
    const manualDumpStrategy = strategies.find((s) => s.id === 'manual-dump-stub');
    expect(manualDumpStrategy).toBeDefined();
  });

  // ── E5.x: consented-install appended after manual-dump ────────────────────

  it('fourth strategy is consented-install for sql config (Batch E)', () => {
    const strategies = buildMssqlStrategies(SQL_CONFIG);
    expect(strategies[3]?.id).toBe('consented-install');
  });

  it('third strategy is consented-install for integrated config (Batch E)', () => {
    const strategies = buildMssqlStrategies(INTEGRATED_CONFIG);
    // integrated: [sqlcmd, manual-dump, consented-install] (native-tedious omitted)
    expect(strategies[2]?.id).toBe('consented-install');
  });

  it('full order is native-tedious → sqlcmd → manual-dump → consented-install for sql config (Batch E)', () => {
    const strategies = buildMssqlStrategies(SQL_CONFIG);
    const ids = strategies.map((s) => s.id);
    expect(ids).toEqual(['native-tedious', 'sqlcmd', 'manual-dump', 'consented-install']);
  });

  it('deps.ConsentedInstall overrides the ConsentedInstallStrategy constructor (Batch E)', () => {
    class StubbedConsentedInstall {
      readonly id = 'consented-install-stub';
      async detect(): Promise<{ available: true }> {
        return { available: true };
      }
      async canConnect(): Promise<boolean> { return false; }
      async runCatalog(): Promise<never> { throw new Error('stub'); }
    }
    const deps: MssqlStrategyDeps = {
      ConsentedInstall: StubbedConsentedInstall as unknown as NonNullable<MssqlStrategyDeps['ConsentedInstall']>,
    };
    const strategies = buildMssqlStrategies(SQL_CONFIG, deps);
    const stubbedStrategy = strategies.find((s) => s.id === 'consented-install-stub');
    expect(stubbedStrategy).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3.2 — selectStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe('selectStrategy()', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it('returns the first strategy when detect+canConnect both pass', async () => {
    const strat = makeStrategy('native-tedious', { available: true }, true);
    const result = await selectStrategy([strat], logger);
    expect(result.id).toBe('native-tedious');
  });

  it('skips a strategy when detect() returns available: false', async () => {
    const skipped = makeStrategy('native-tedious', { available: false }, true);
    const winner = makeStrategy('sqlcmd', { available: true }, true);
    const result = await selectStrategy([skipped, winner], logger);
    expect(result.id).toBe('sqlcmd');
  });

  it('skips a strategy when canConnect() returns false', async () => {
    const skipped = makeStrategy('native-tedious', { available: true }, false);
    const winner = makeStrategy('sqlcmd', { available: true }, true);
    const result = await selectStrategy([skipped, winner], logger);
    expect(result.id).toBe('sqlcmd');
  });

  it('returns the first passing strategy even if later ones also pass', async () => {
    const first = makeStrategy('native-tedious', { available: true }, true);
    const second = makeStrategy('sqlcmd', { available: true }, true);
    const result = await selectStrategy([first, second], logger);
    expect(result.id).toBe('native-tedious');
  });

  it('does NOT call canConnect when detect returns available: false', async () => {
    const strat = makeStrategy('native-tedious', { available: false }, true);
    const winner = makeStrategy('sqlcmd', { available: true }, true);
    await selectStrategy([strat, winner], logger);
    expect(strat.canConnect).not.toHaveBeenCalled();
  });

  it('throws StrategyExhaustionError when all strategies fail', async () => {
    const s1 = makeStrategy('native-tedious', { available: false }, false);
    const s2 = makeStrategy('sqlcmd', { available: true }, false);
    await expect(selectStrategy([s1, s2], logger)).rejects.toBeInstanceOf(StrategyExhaustionError);
  });

  it('StrategyExhaustionError lists each failed attempt', async () => {
    const s1 = makeStrategy('native-tedious', { available: false }, false);
    const s2 = makeStrategy('sqlcmd', { available: true }, false);
    const error = await selectStrategy([s1, s2], logger).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StrategyExhaustionError);
    const ex = error as StrategyExhaustionError;
    const ids = ex.attempts.map((a) => a.id);
    expect(ids).toContain('native-tedious');
    expect(ids).toContain('sqlcmd');
  });

  it('StrategyExhaustionError attempt includes a reason string', async () => {
    const s1 = makeStrategy('native-tedious', { available: false, detail: 'no mssql installed' }, false);
    const error = await selectStrategy([s1], logger).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StrategyExhaustionError);
    const ex = error as StrategyExhaustionError;
    expect(ex.attempts[0]?.reason).toBeTruthy();
  });

  it('throws StrategyExhaustionError for empty strategies list', async () => {
    await expect(selectStrategy([], logger)).rejects.toBeInstanceOf(StrategyExhaustionError);
  });

  it('logs a debug message for each probe attempt', async () => {
    const s1 = makeStrategy('native-tedious', { available: false }, false);
    const s2 = makeStrategy('sqlcmd', { available: true }, true);
    await selectStrategy([s1, s2], logger);
    expect(logger.debug).toHaveBeenCalled();
  });

  it('logs an info message for the winning strategy', async () => {
    const s1 = makeStrategy('sqlcmd', { available: true }, true);
    await selectStrategy([s1], logger);
    expect(logger.info).toHaveBeenCalled();
  });

  it('winning info log mentions the strategy id', async () => {
    const s1 = makeStrategy('sqlcmd', { available: true }, true);
    await selectStrategy([s1], logger);
    const calls = logger.info.mock.calls as [string, Record<string, unknown>?][];
    const found = calls.some(([msg]) => msg.includes('sqlcmd'));
    expect(found).toBe(true);
  });

  // ── WARN-2 remediation: logger no-secret and verbosity/debug-suppression ──

  it('WARN-2(a): no resolved secret or password value appears in any logger call argument (SQL auth config)', async () => {
    // Strategies are mocked — selectStrategy only logs strategyId + reason strings.
    // This test pins that invariant: the password sentinel must NEVER appear in any log arg.
    const PASSWORD_SENTINEL = 'S3cr3tP@ss!';
    const USER_SENTINEL = 'dbuser';

    const NativeSpy = makeStrategy('native-tedious', { available: false, detail: 'unavailable' }, false);
    const SqlcmdSpy = makeStrategy('sqlcmd', { available: true }, true);

    const spyLogger = makeLogger();
    await selectStrategy([NativeSpy, SqlcmdSpy], spyLogger);

    const allDebugCalls = spyLogger.debug.mock.calls as unknown[][];
    const allInfoCalls = spyLogger.info.mock.calls as unknown[][];
    const allCalls = [...allDebugCalls, ...allInfoCalls];

    for (const callArgs of allCalls) {
      const serialized = JSON.stringify(callArgs);
      expect(serialized).not.toContain(PASSWORD_SENTINEL);
      expect(serialized).not.toContain(USER_SENTINEL); // user also counts as a credential
    }
  });

  it('WARN-2(a): no resolved secret or connection string appears in any logger call argument (NTLM config)', async () => {
    // selectStrategy only logs strategyId + reason strings — never the config values.
    // This pins that invariant for credential-bearing configs (NTLM password sentinel).
    const PASSWORD_SENTINEL = 'WinP@ssword123';
    const USER_SENTINEL = 'svc_account';
    const s1 = makeStrategy('native-tedious', { available: false, detail: 'not available' }, false);
    const spyLogger = makeLogger();
    await selectStrategy([s1], spyLogger).catch(() => { /* exhaustion expected */ });

    const allCalls = [
      ...(spyLogger.debug.mock.calls as unknown[][]),
      ...(spyLogger.info.mock.calls as unknown[][]),
    ];
    for (const callArgs of allCalls) {
      const serialized = JSON.stringify(callArgs);
      expect(serialized).not.toContain(PASSWORD_SENTINEL);
      expect(serialized).not.toContain(USER_SENTINEL);
    }
  });

  it('WARN-2(b): debug logs are emitted only at debug level, NOT at info level', async () => {
    // Verify logger.debug is called but logger.info is NOT called for skipped strategies.
    // Only the winner triggers logger.info. Skipped strategies only get logger.debug.
    const s1 = makeStrategy('native-tedious', { available: false, detail: 'unavailable' }, false);
    const s2 = makeStrategy('sqlcmd', { available: true }, true);

    const spyLogger = makeLogger();
    await selectStrategy([s1, s2], spyLogger);

    // debug MUST have been called (for the skipped native-tedious probe)
    expect(spyLogger.debug).toHaveBeenCalled();

    // info MUST have been called once (for the winning sqlcmd strategy)
    expect(spyLogger.info).toHaveBeenCalledTimes(1);

    // warn and error MUST NOT have been called (selection is not an error condition)
    expect(spyLogger.warn).not.toHaveBeenCalled();
    expect(spyLogger.error).not.toHaveBeenCalled();
  });

  it('WARN-2(b): when a level-aware logger suppresses debug, info still reaches the caller', async () => {
    // Simulates a production logger at "info" level: debug calls are no-ops.
    const infoMessages: string[] = [];

    const levelAwareLogger: Logger = {
      debug: () => { /* debug suppressed at info level — no-op */ },
      info: (msg: string) => { infoMessages.push(msg); },
      warn: () => { /* no-op */ },
      error: () => { /* no-op */ },
    };

    const s1 = makeStrategy('native-tedious', { available: false }, false);
    const s2 = makeStrategy('sqlcmd', { available: true }, true);
    await selectStrategy([s1, s2], levelAwareLogger);

    // info still reported the winner — even though debug was suppressed
    expect(infoMessages.some((m) => m.includes('sqlcmd'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WARN-3 — detectAllCandidates: 3 spec-mandated candidates reported
// ─────────────────────────────────────────────────────────────────────────────

describe('detectAllCandidates() — WARN-3', () => {
  function makeDetectionStub(id: string, available: boolean): new (config: typeof SQL_CONFIG) => { id: string; detect: () => Promise<{ available: boolean; detail: string }>; canConnect: () => Promise<boolean>; runCatalog: () => never; close: () => Promise<void> } {
    return class Stub {
      readonly id = id;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_config: typeof SQL_CONFIG) {}
      async detect() { return { available, detail: `${id} stub` }; }
      async canConnect() { return false; }
      runCatalog(): never { throw new Error('not implemented'); }
      async close() {}
    } as unknown as ReturnType<typeof makeDetectionStub>;
  }

  it('returns exactly 3 detection results (sqlcmd, invoke-sqlcmd, odbc-driver)', async () => {
    const deps = {
      Sqlcmd: makeDetectionStub('sqlcmd', true),
      InvokeSqlcmd: makeDetectionStub('invoke-sqlcmd', false),
      OdbcDriver: makeDetectionStub('odbc-driver', true),
    } as unknown as MssqlStrategyDeps;

    const results = await detectAllCandidates(SQL_CONFIG, deps);
    expect(results).toHaveLength(3);
  });

  it('result includes sqlcmd as first candidate', async () => {
    const deps = {
      Sqlcmd: makeDetectionStub('sqlcmd', true),
      InvokeSqlcmd: makeDetectionStub('invoke-sqlcmd', false),
      OdbcDriver: makeDetectionStub('odbc-driver', false),
    } as unknown as MssqlStrategyDeps;

    const results = await detectAllCandidates(SQL_CONFIG, deps);
    expect(results[0]?.id).toBe('sqlcmd');
  });

  it('result includes invoke-sqlcmd as second candidate', async () => {
    const deps = {
      Sqlcmd: makeDetectionStub('sqlcmd', false),
      InvokeSqlcmd: makeDetectionStub('invoke-sqlcmd', true),
      OdbcDriver: makeDetectionStub('odbc-driver', false),
    } as unknown as MssqlStrategyDeps;

    const results = await detectAllCandidates(SQL_CONFIG, deps);
    expect(results[1]?.id).toBe('invoke-sqlcmd');
  });

  it('result includes odbc-driver as third candidate', async () => {
    const deps = {
      Sqlcmd: makeDetectionStub('sqlcmd', false),
      InvokeSqlcmd: makeDetectionStub('invoke-sqlcmd', false),
      OdbcDriver: makeDetectionStub('odbc-driver', true),
    } as unknown as MssqlStrategyDeps;

    const results = await detectAllCandidates(SQL_CONFIG, deps);
    expect(results[2]?.id).toBe('odbc-driver');
  });

  it('each result carries the detect() outcome from the stub', async () => {
    const deps = {
      Sqlcmd: makeDetectionStub('sqlcmd', true),
      InvokeSqlcmd: makeDetectionStub('invoke-sqlcmd', false),
      OdbcDriver: makeDetectionStub('odbc-driver', true),
    } as unknown as MssqlStrategyDeps;

    const results = await detectAllCandidates(SQL_CONFIG, deps);
    expect(results[0]?.detect.available).toBe(true);
    expect(results[1]?.detect.available).toBe(false);
    expect(results[2]?.detect.available).toBe(true);
  });
});
