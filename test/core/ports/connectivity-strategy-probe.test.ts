/**
 * Tests for optional probe?() on ConnectivityStrategy — task 1.4 (resilient-connectivity Batch 1).
 *
 * Spec: connectivity-diagnostics "Probe port stays driver-free and core-typed":
 *   - probe() is optional on ConnectivityStrategy (back-compat)
 *   - a strategy WITHOUT probe still satisfies ConnectivityStrategy
 *   - ProbeResult is imported type-only from capability-probe.js (driver-free)
 *
 * Design §"probe() is OPTIONAL on the strategy port" — back-compat (existing strategies
 *   that omit it still satisfy the port).
 *
 * TDD: RED → GREEN.
 * This test is additive — the existing connectivity-strategy.test.ts is UNCHANGED.
 */

import { describe, it, expect } from 'vitest';
import type {
  ConnectivityStrategy,
} from '../../../src/core/ports/connectivity-strategy.js';
import type { ProbeResult } from '../../../src/core/ports/capability-probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// Stub helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMinimalStrategy(): ConnectivityStrategy {
  return {
    id: 'test-no-probe',
    detect: () => Promise.resolve({ available: true }),
    canConnect: () => Promise.resolve(true),
    runCatalog: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
  };
}

function makeStrategyWithProbe(): ConnectivityStrategy {
  const probeResult: ProbeResult = {
    nativeDriver: true,
    cliTools: [{ tool: 'sqlcmd', version: '15.0', path: 'C:\\sqlcmd.exe' }],
    odbc: false,
  };
  return {
    id: 'test-with-probe',
    detect: () => Promise.resolve({ available: true }),
    canConnect: () => Promise.resolve(true),
    runCatalog: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
    probe: () => Promise.resolve(probeResult),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Back-compat: strategy WITHOUT probe satisfies ConnectivityStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectivityStrategy — probe is optional (back-compat)', () => {
  it('a strategy without probe() type-checks as ConnectivityStrategy', () => {
    const strategy = makeMinimalStrategy();
    expect(strategy.id).toBe('test-no-probe');
    expect(strategy.probe).toBeUndefined();
  });

  it('detect/canConnect/runCatalog work on a no-probe strategy', async () => {
    const strategy = makeMinimalStrategy();
    const detectResult = await strategy.detect();
    expect(detectResult.available).toBe(true);
    const canConnect = await strategy.canConnect();
    expect(canConnect).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategy WITH probe() satisfies the contract
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectivityStrategy — optional probe() when present', () => {
  it('a strategy with probe() type-checks as ConnectivityStrategy', () => {
    const strategy = makeStrategyWithProbe();
    expect(strategy.id).toBe('test-with-probe');
    expect(typeof strategy.probe).toBe('function');
  });

  it('probe() resolves a ProbeResult', async () => {
    const strategy = makeStrategyWithProbe();
    const result = await strategy.probe?.();
    expect(result).toBeDefined();
    expect(result?.nativeDriver).toBe(true);
    expect(result?.cliTools).toHaveLength(1);
    expect(result?.odbc).toBe(false);
  });

  it('probe result carries CliToolInfo with tool, version, and path', async () => {
    const strategy = makeStrategyWithProbe();
    const result = await strategy.probe?.();
    const tool = result?.cliTools[0];
    expect(tool?.tool).toBe('sqlcmd');
    expect(tool?.version).toBe('15.0');
    expect(tool?.path).toBe('C:\\sqlcmd.exe');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-throwing contract of probe()
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectivityStrategy — probe() MUST NOT throw', () => {
  it('probe() resolves even when all methods are unavailable', async () => {
    const absentResult: ProbeResult = {
      nativeDriver: false,
      cliTools: [{ tool: 'sqlcmd', version: null, path: null }],
      odbc: false,
    };
    const strategy: ConnectivityStrategy = {
      id: 'test-absent-probe',
      detect: () => Promise.resolve({ available: false }),
      canConnect: () => Promise.resolve(false),
      runCatalog: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
      probe: () => Promise.resolve(absentResult),
    };

    await expect(strategy.probe?.()).resolves.toMatchObject({ nativeDriver: false });
  });
});
