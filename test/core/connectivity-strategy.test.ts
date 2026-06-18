/**
 * Tests for the ConnectivityStrategy port — A1.1 (connectivity-strategies Batch A).
 * Spec connectivity "Port is driver-free and core-typed".
 * TDD: RED → GREEN.
 *
 * This file asserts the SHAPE of the port types only. No implementation detail.
 * The boundary test (boundaries.test.ts) independently asserts the import hygiene.
 */

import { describe, it, expect } from 'vitest';
import type {
  ConnectivityStrategy,
  DetectResult,
  StrategyAttempt,
} from '../../src/core/ports/connectivity-strategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// DetectResult shape
// ─────────────────────────────────────────────────────────────────────────────

describe('DetectResult', () => {
  it('accepts { available: true }', () => {
    const result: DetectResult = { available: true };
    expect(result.available).toBe(true);
  });

  it('accepts { available: false }', () => {
    const result: DetectResult = { available: false };
    expect(result.available).toBe(false);
  });

  it('accepts optional detail field', () => {
    const result: DetectResult = { available: true, detail: 'sqlcmd 16.0' };
    expect(result.detail).toBe('sqlcmd 16.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StrategyAttempt shape
// ─────────────────────────────────────────────────────────────────────────────

describe('StrategyAttempt', () => {
  it('carries id and reason', () => {
    const attempt: StrategyAttempt = { id: 'sqlcmd', reason: 'not detected on PATH' };
    expect(attempt.id).toBe('sqlcmd');
    expect(attempt.reason).toBe('not detected on PATH');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConnectivityStrategy interface — implemented by a test double
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectivityStrategy', () => {
  it('is implementable by a test double with the required shape', () => {
    const strategy: ConnectivityStrategy = {
      id: 'test-strategy',
      detect: () => Promise.resolve({ available: true }),
      canConnect: () => Promise.resolve(true),
      runCatalog: () =>
        Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
    };

    expect(strategy.id).toBe('test-strategy');
  });

  it('detect() resolves DetectResult', async () => {
    const strategy: ConnectivityStrategy = {
      id: 'test',
      detect: () => Promise.resolve({ available: false, detail: 'not found' }),
      canConnect: () => Promise.resolve(false),
      runCatalog: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
    };
    const result = await strategy.detect();
    expect(result.available).toBe(false);
    expect(result.detail).toBe('not found');
  });

  it('canConnect() resolves boolean', async () => {
    const strategy: ConnectivityStrategy = {
      id: 'test',
      detect: () => Promise.resolve({ available: true }),
      canConnect: () => Promise.resolve(true),
      runCatalog: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
    };
    const result = await strategy.canConnect();
    expect(result).toBe(true);
  });

  it('runCatalog() resolves RawCatalog', async () => {
    const catalog = { engine: 'mssql', schemas: ['dbo'], objects: [] };
    const strategy: ConnectivityStrategy = {
      id: 'test',
      detect: () => Promise.resolve({ available: true }),
      canConnect: () => Promise.resolve(true),
      runCatalog: () => Promise.resolve(catalog),
    };
    const scope = {
      levels: {
        tables: 'full' as const,
        columns: 'full' as const,
        constraints: 'full' as const,
        indexes: 'full' as const,
        views: 'full' as const,
        procedures: 'metadata' as const,
        functions: 'metadata' as const,
        triggers: 'full' as const,
        sequences: 'metadata' as const,
        collections: 'metadata' as const,
        fields: 'metadata' as const,
        statistics: 'off' as const,
        sampling: 'off' as const,
      },
    };
    const result = await strategy.runCatalog(scope);
    expect(result.engine).toBe('mssql');
    expect(result.schemas).toEqual(['dbo']);
  });

  it('close() is optional', () => {
    // A strategy without close() is valid
    const withoutClose: ConnectivityStrategy = {
      id: 'no-close',
      detect: () => Promise.resolve({ available: true }),
      canConnect: () => Promise.resolve(true),
      runCatalog: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
    };
    expect(withoutClose.close).toBeUndefined();
  });

  it('close() when present is callable', async () => {
    let closed = false;
    const withClose: ConnectivityStrategy = {
      id: 'with-close',
      detect: () => Promise.resolve({ available: true }),
      canConnect: () => Promise.resolve(true),
      runCatalog: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
      close: async () => {
        closed = true;
      },
    };
    await withClose.close?.();
    expect(closed).toBe(true);
  });
});
