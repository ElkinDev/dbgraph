/**
 * Tests for typed error classes.
 * Each error must carry a stable `code` and extend DbgraphError.
 * Design §7.1. Story: all core error paths.
 * TDD phase: RED — fails until src/core/errors.ts is created.
 */

import { describe, expect, it } from 'vitest';
import {
  DbgraphError,
  NormalizationError,
  StorageError,
  SchemaVersionError,
  QueryError,
  NotFoundError,
  ConnectionError,
  PermissionError,
  ConfigError,
  UnsupportedDialectError,
  StrategyExhaustionError,
} from '../../src/core/errors.js';
import type { StrategyAttempt } from '../../src/core/ports/connectivity-strategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// DbgraphError base
// ─────────────────────────────────────────────────────────────────────────────

describe('DbgraphError', () => {
  it('is an instance of Error', () => {
    const err = new DbgraphError('base error', 'E_BASE');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DbgraphError);
  });

  it('carries the provided message', () => {
    const err = new DbgraphError('something failed', 'E_BASE');
    expect(err.message).toBe('something failed');
  });

  it('carries the stable code', () => {
    const err = new DbgraphError('something failed', 'E_BASE');
    expect(err.code).toBe('E_BASE');
  });

  it('sets name to the constructor name', () => {
    const err = new DbgraphError('msg', 'E_BASE');
    expect(err.name).toBe('DbgraphError');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NormalizationError
// ─────────────────────────────────────────────────────────────────────────────

describe('NormalizationError', () => {
  it('extends DbgraphError', () => {
    const err = new NormalizationError('invalid object kind: sprocket');
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err).toBeInstanceOf(NormalizationError);
  });

  it('carries stable code E_NORMALIZE', () => {
    const err = new NormalizationError('object dbo.orders: missing name field');
    expect(err.code).toBe('E_NORMALIZE');
  });

  it('sets name to NormalizationError', () => {
    const err = new NormalizationError('msg');
    expect(err.name).toBe('NormalizationError');
  });

  it('preserves an actionable message describing which object failed', () => {
    const msg = 'object dbo.orders: constraint FK_x has misaligned columns (2 src, 3 dst)';
    const err = new NormalizationError(msg);
    expect(err.message).toBe(msg);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StorageError
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageError', () => {
  it('extends DbgraphError with code E_STORAGE', () => {
    const err = new StorageError('disk full');
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_STORAGE');
    expect(err.name).toBe('StorageError');
  });

  it('can wrap an underlying driver error', () => {
    const cause = new Error('SQLITE_FULL');
    const err = new StorageError('upsert failed', cause);
    expect(err.message).toBe('upsert failed');
    expect(err.cause).toBe(cause);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SchemaVersionError
// ─────────────────────────────────────────────────────────────────────────────

describe('SchemaVersionError', () => {
  it('extends DbgraphError with code E_SCHEMA_VERSION', () => {
    const err = new SchemaVersionError(2, 1);
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_SCHEMA_VERSION');
    expect(err.name).toBe('SchemaVersionError');
  });

  it('exposes observed and supported versions', () => {
    const err = new SchemaVersionError(3, 1);
    expect(err.observed).toBe(3);
    expect(err.supported).toBe(1);
  });

  it('message includes remediation hint', () => {
    const err = new SchemaVersionError(3, 1);
    expect(err.message).toContain('re-sync');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QueryError
// ─────────────────────────────────────────────────────────────────────────────

describe('QueryError', () => {
  it('extends DbgraphError with code E_QUERY', () => {
    const err = new QueryError('depth must be >= 1');
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_QUERY');
    expect(err.name).toBe('QueryError');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NotFoundError
// ─────────────────────────────────────────────────────────────────────────────

describe('NotFoundError', () => {
  it('extends DbgraphError with code E_NOT_FOUND', () => {
    const err = new NotFoundError('node', 'abc123');
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_NOT_FOUND');
    expect(err.name).toBe('NotFoundError');
  });

  it('message includes what was looked up', () => {
    const err = new NotFoundError('node', 'abc123');
    expect(err.message).toContain('abc123');
  });

  it('message includes remediation hint about re-sync', () => {
    const err = new NotFoundError('node', 'abc123');
    expect(err.message).toContain('re-sync');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionError (US-026 / US-031)
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectionError', () => {
  it('extends DbgraphError with code E_CONNECTION', () => {
    const err = new ConnectionError('Source database not found at /tmp/x.db. Check the path.');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_CONNECTION');
    expect(err.name).toBe('ConnectionError');
  });

  it('carries the actionable message as-is', () => {
    const msg = 'Source database not found at /tmp/x.db. Check the path.';
    const err = new ConnectionError(msg);
    expect(err.message).toBe(msg);
  });

  it('accepts and stores an underlying cause', () => {
    const cause = new Error('ENOENT: no such file');
    const err = new ConnectionError('Source database not found at /tmp/x.db. Check the path.', cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is absent when not provided', () => {
    const err = new ConnectionError('msg without cause');
    expect(err.cause).toBeUndefined();
  });

  it('message for corrupt database is actionable', () => {
    const err = new ConnectionError('/tmp/x.db is not a valid SQLite database.');
    expect(err.message).toContain('not a valid SQLite database');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PermissionError (US-031)
// ─────────────────────────────────────────────────────────────────────────────

describe('PermissionError', () => {
  it('extends DbgraphError with code E_PERMISSION', () => {
    const err = new PermissionError('Cannot write to read-only connection.');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DbgraphError);
    expect(err.code).toBe('E_PERMISSION');
    expect(err.name).toBe('PermissionError');
  });

  it('carries the actionable message as-is', () => {
    const msg = 'Cannot write to read-only connection.';
    const err = new PermissionError(msg);
    expect(err.message).toBe(msg);
  });

  it('accepts and stores an underlying cause', () => {
    const cause = new Error('SQLITE_READONLY');
    const err = new PermissionError('Cannot write to read-only connection.', cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is absent when not provided', () => {
    const err = new PermissionError('no cause');
    expect(err.cause).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConfigError — task 1.1 (phase-4-cli-config)
// ─────────────────────────────────────────────────────────────────────────────

describe('ConfigError', () => {
  it('is an instance of Error', () => {
    const err = new ConfigError('bad config');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of DbgraphError', () => {
    const err = new ConfigError('bad config');
    expect(err).toBeInstanceOf(DbgraphError);
  });

  it('is an instance of ConfigError', () => {
    const err = new ConfigError('bad config');
    expect(err).toBeInstanceOf(ConfigError);
  });

  it('carries stable code E_CONFIG', () => {
    const err = new ConfigError('bad config');
    expect(err.code).toBe('E_CONFIG');
  });

  it('name is ConfigError', () => {
    const err = new ConfigError('bad config');
    expect(err.name).toBe('ConfigError');
  });

  it('preserves the message passed in', () => {
    const msg = 'Field "dialect" is required but missing.';
    const err = new ConfigError(msg);
    expect(err.message).toBe(msg);
  });

  it('can carry an actionable message naming a field', () => {
    const err = new ConfigError(
      'Field "host" must be a ${env:VAR} reference, not a literal value.',
    );
    expect(err.message).toContain('host');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UnsupportedDialectError — task 1.1 (phase-4-cli-config)
// ─────────────────────────────────────────────────────────────────────────────

describe('UnsupportedDialectError', () => {
  it('is an instance of Error', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of DbgraphError', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err).toBeInstanceOf(DbgraphError);
  });

  it('is an instance of UnsupportedDialectError', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err).toBeInstanceOf(UnsupportedDialectError);
  });

  it('carries stable code E_UNSUPPORTED_DIALECT', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.code).toBe('E_UNSUPPORTED_DIALECT');
  });

  it('name is UnsupportedDialectError', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.name).toBe('UnsupportedDialectError');
  });

  it('message includes the bad dialect name', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('oracle');
  });

  it('message lists available dialects', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toMatch(/sqlite|mssql/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StrategyExhaustionError — connectivity-strategies A1.3
// ─────────────────────────────────────────────────────────────────────────────

describe('StrategyExhaustionError', () => {
  const attempts: StrategyAttempt[] = [
    { id: 'native-tedious', reason: 'integrated auth not supported by driver' },
    { id: 'sqlcmd', reason: 'not detected on PATH' },
    { id: 'manual-dump', reason: 'dump file not found' },
  ];

  it('is an instance of Error', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of DbgraphError', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err).toBeInstanceOf(DbgraphError);
  });

  it('is an instance of StrategyExhaustionError', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err).toBeInstanceOf(StrategyExhaustionError);
  });

  it('carries stable code E_STRATEGY_EXHAUSTION', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.code).toBe('E_STRATEGY_EXHAUSTION');
  });

  it('name is StrategyExhaustionError', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.name).toBe('StrategyExhaustionError');
  });

  it('carries the attempts array', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.attempts).toBe(attempts);
  });

  it('attempts is readonly and has correct length', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.attempts).toHaveLength(3);
  });

  it('message lists each attempt id', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.message).toContain('native-tedious');
    expect(err.message).toContain('sqlcmd');
    expect(err.message).toContain('manual-dump');
  });

  it('message lists each attempt reason', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.message).toContain('not detected on PATH');
    expect(err.message).toContain('dump file not found');
  });

  it('message format is "{id} — {reason}" for each attempt', () => {
    const err = new StrategyExhaustionError(attempts);
    expect(err.message).toContain('sqlcmd — not detected on PATH');
  });

  it('works with an empty attempts array', () => {
    const err = new StrategyExhaustionError([]);
    expect(err).toBeInstanceOf(StrategyExhaustionError);
    expect(err.attempts).toHaveLength(0);
  });
});
