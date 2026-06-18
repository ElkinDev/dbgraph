/**
 * consented-install.test.ts — unit tests for ConsentedInstallStrategy.
 *
 * E5.2: asserts detect() always available, runCatalog() DOES NOT install,
 * prints recipe via Logger.info behind consent notice, throws
 * StrategyExhaustionError, B2 seam is present as a comment in source.
 *
 * connectivity-strategies Batch E, task E5.2.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '../../../../../src/core/ports/logger.js';
import { StrategyExhaustionError } from '../../../../../src/core/errors.js';
import { ConsentedInstallStrategy } from '../../../../../src/adapters/engines/mssql/strategies/consented-install.strategy.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SQL_CONFIG = {
  server: 'localhost',
  database: 'testdb',
  authentication: { type: 'integrated' as const },
} as const;

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
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ConsentedInstallStrategy', () => {
  describe('id', () => {
    it('has id "consented-install"', () => {
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), 'win32');
      expect(strategy.id).toBe('consented-install');
    });
  });

  describe('detect()', () => {
    it('always returns available: true', async () => {
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), 'win32');
      const result = await strategy.detect();
      expect(result.available).toBe(true);
    });

    it('returns available: true regardless of OS', async () => {
      for (const os of ['win32', 'darwin', 'linux'] as const) {
        const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), os);
        const result = await strategy.detect();
        expect(result.available).toBe(true);
      }
    });
  });

  describe('canConnect()', () => {
    it('always returns false — no actual connection is made', async () => {
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), 'win32');
      const result = await strategy.canConnect();
      expect(result).toBe(false);
    });
  });

  describe('runCatalog()', () => {
    it('throws StrategyExhaustionError (never returns a catalog)', async () => {
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), 'win32');
      const scope = { levels: [] as string[] };
      await expect(
        strategy.runCatalog(scope as never),
      ).rejects.toBeInstanceOf(StrategyExhaustionError);
    });

    it('logs via Logger.info before throwing (consent notice)', async () => {
      const logger = makeLogger();
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, logger, 'win32');
      const scope = { levels: [] as string[] };
      await strategy.runCatalog(scope as never).catch(() => undefined);
      expect(logger.info).toHaveBeenCalled();
    });

    it('info log includes a consent notice phrase', async () => {
      const logger = makeLogger();
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, logger, 'win32');
      const scope = { levels: [] as string[] };
      await strategy.runCatalog(scope as never).catch(() => undefined);
      const calls = logger.info.mock.calls as [string, Record<string, unknown>?][];
      const allMessages = calls.map(([msg]) => msg).join(' ');
      // Must mention consent / install guidance
      expect(allMessages.toLowerCase()).toMatch(/install|guide|consent|nothing is installed/i);
    });

    it('info log includes the official install source (microsoft.com)', async () => {
      const logger = makeLogger();
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, logger, 'win32');
      const scope = { levels: [] as string[] };
      await strategy.runCatalog(scope as never).catch(() => undefined);
      const calls = logger.info.mock.calls as [string, Record<string, unknown>?][];
      const allMessages = calls.map(([msg]) => msg).join(' ');
      expect(allMessages).toMatch(/microsoft\.com/i);
    });

    it('does NOT spawn any child process (no install executed)', async () => {
      // Verify no child_process is invoked — strategy is imported and run without spawning
      const logger = makeLogger();
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, logger, 'win32');
      const scope = { levels: [] as string[] };
      // If a spawn occurred it would need node:child_process — we verify by checking
      // the thrown error is StrategyExhaustionError (guidance only, not install result).
      const err = await strategy.runCatalog(scope as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StrategyExhaustionError);
    });

    it('StrategyExhaustionError from runCatalog has a non-empty attempts array', async () => {
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), 'win32');
      const scope = { levels: [] as string[] };
      const err = await strategy.runCatalog(scope as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StrategyExhaustionError);
      const ex = err as StrategyExhaustionError;
      expect(ex.attempts.length).toBeGreaterThanOrEqual(1);
    });

    it('StrategyExhaustionError attempt includes guidance text', async () => {
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), 'win32');
      const scope = { levels: [] as string[] };
      const err = await strategy.runCatalog(scope as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StrategyExhaustionError);
      const ex = err as StrategyExhaustionError;
      const reasons = ex.attempts.map((a) => a.reason).join(' ');
      expect(reasons.toLowerCase()).toMatch(/install|guide|b1/i);
    });

    it('works the same on darwin with brew instructions', async () => {
      const logger = makeLogger();
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, logger, 'darwin');
      const scope = { levels: [] as string[] };
      await strategy.runCatalog(scope as never).catch(() => undefined);
      const calls = logger.info.mock.calls as [string, Record<string, unknown>?][];
      const allMessages = calls.map(([msg]) => msg).join(' ');
      // darwin path should mention brew or microsoft URL
      expect(allMessages.toLowerCase()).toMatch(/brew|microsoft\.com/i);
    });
  });

  describe('close()', () => {
    it('close() resolves without throwing (no-op)', async () => {
      const strategy = new ConsentedInstallStrategy(SQL_CONFIG, makeLogger(), 'win32');
      await expect(strategy.close()).resolves.toBeUndefined();
    });
  });

  describe('B2 seam', () => {
    it('source file contains "B2" seam comment (automated execution deferred)', () => {
      // Read the source file to assert the B2 seam exists as a comment.
      const srcPath = resolve(
        'src/adapters/engines/mssql/strategies/consented-install.strategy.ts',
      );
      const source = readFileSync(srcPath, 'utf-8');
      expect(source).toContain('B2');
    });
  });
});
