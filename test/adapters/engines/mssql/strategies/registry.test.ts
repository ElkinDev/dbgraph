/**
 * registry.test.ts — unit tests for buildMssqlStrategies + selectStrategy.
 *
 * C3.1: buildMssqlStrategies returns ordered list (native-tedious, sqlcmd) for
 *       explicit-credential configs; integrated config omits native-tedious.
 * C3.2: selectStrategy iterates detect() + canConnect(), logs each probe via Logger,
 *       returns first that passes both; throws StrategyExhaustionError if none pass.
 *
 * All strategies are mocked — no real sqlcmd, no real mssql pool.
 * connectivity-strategies Batch C, tasks C3.1–C3.2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectivityStrategy, DetectResult } from '../../../../../src/core/ports/connectivity-strategy.js';
import type { Logger } from '../../../../../src/core/ports/logger.js';
import { StrategyExhaustionError } from '../../../../../src/core/errors.js';
import {
  buildMssqlStrategies,
  selectStrategy,
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
});
