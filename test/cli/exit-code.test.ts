/**
 * Tests for exitCodeFor — task 2.3 (phase-4-cli-config).
 * Spec: cli-config "CLI exit codes are a stable contract" (all 3 scenarios).
 * Design Decision 9:
 *   0  success (HandlerOutcome { type: 'success' })
 *   1  negative result (HandlerOutcome { type: 'negative' }) — zero hits / diff has changes
 *   2  ConnectionError (any message variant) + unknown command
 *   3  PermissionError (names exact permission)
 *   4  UnsupportedDialectError (lists dialects)
 *   2  any other DbgraphError (incl. ConfigError, SchemaVersionError, generic)
 * Pure mapper: no I/O, no process.exit.
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */

import { describe, it, expect } from 'vitest';
import { exitCodeFor } from '../../src/cli/exit-code.js';
import {
  ConnectionError,
  PermissionError,
  UnsupportedDialectError,
  ConfigError,
  DbgraphError,
  SchemaVersionError,
  StorageError,
} from '../../src/index.js';
import type { HandlerOutcome } from '../../src/cli/dispatch.js';

// ─────────────────────────────────────────────────────────────────────────────
// Success outcomes → exit 0
// ─────────────────────────────────────────────────────────────────────────────

describe('exitCodeFor — success → 0', () => {
  it('returns 0 for HandlerOutcome success', () => {
    const outcome: HandlerOutcome = { type: 'success' };
    expect(exitCodeFor(outcome)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Negative result outcomes → exit 1
// ─────────────────────────────────────────────────────────────────────────────

describe('exitCodeFor — negative result → 1', () => {
  it('returns 1 for HandlerOutcome negative (zero hits)', () => {
    const outcome: HandlerOutcome = { type: 'negative' };
    expect(exitCodeFor(outcome)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionError → exit 2
// ─────────────────────────────────────────────────────────────────────────────

describe('exitCodeFor — ConnectionError → 2', () => {
  it('returns 2 for ConnectionError (DNS not resolved variant)', () => {
    const err = new ConnectionError('DNS does not resolve: host "bad-host.example.com"');
    expect(exitCodeFor(err)).toBe(2);
  });

  it('returns 2 for ConnectionError (connection refused variant)', () => {
    const err = new ConnectionError('Connection refused: localhost:1433');
    expect(exitCodeFor(err)).toBe(2);
  });

  it('returns 2 for ConnectionError (timeout variant)', () => {
    const err = new ConnectionError('Connection timed out after 30 000 ms');
    expect(exitCodeFor(err)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown command → exit 2
// ─────────────────────────────────────────────────────────────────────────────

describe('exitCodeFor — unknown command → 2', () => {
  it('returns 2 for the unknown-command sentinel', () => {
    expect(exitCodeFor({ type: 'unknownCommand', command: 'bogus' })).toBe(2);
  });

  it('returns 2 for the unknown-command sentinel with any name', () => {
    expect(exitCodeFor({ type: 'unknownCommand', command: '' })).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PermissionError → exit 3
// ─────────────────────────────────────────────────────────────────────────────

describe('exitCodeFor — PermissionError → 3', () => {
  it('returns 3 for PermissionError', () => {
    const err = new PermissionError('Requires VIEW DEFINITION permission on sys.sql_modules');
    expect(exitCodeFor(err)).toBe(3);
  });

  it('returns 3 for PermissionError regardless of message content', () => {
    const err = new PermissionError('Missing SELECT on information_schema');
    expect(exitCodeFor(err)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UnsupportedDialectError → exit 4
// ─────────────────────────────────────────────────────────────────────────────

describe('exitCodeFor — UnsupportedDialectError → 4', () => {
  it('returns 4 for UnsupportedDialectError', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(exitCodeFor(err)).toBe(4);
  });

  it('returns 4 for any UnsupportedDialectError', () => {
    const err = new UnsupportedDialectError('redis');
    expect(exitCodeFor(err)).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConfigError + other DbgraphError → exit 2
// ─────────────────────────────────────────────────────────────────────────────

describe('exitCodeFor — ConfigError + other DbgraphError → 2', () => {
  it('returns 2 for ConfigError', () => {
    const err = new ConfigError('field "dialect" is missing');
    expect(exitCodeFor(err)).toBe(2);
  });

  it('returns 2 for SchemaVersionError', () => {
    const err = new SchemaVersionError(3, 2);
    expect(exitCodeFor(err)).toBe(2);
  });

  it('returns 2 for StorageError', () => {
    const err = new StorageError('database locked');
    expect(exitCodeFor(err)).toBe(2);
  });

  it('returns 2 for a bare DbgraphError subclass', () => {
    // Any other typed DbgraphError that does not match a specific code → 2
    class CustomError extends DbgraphError {
      constructor() {
        super('custom error', 'E_CUSTOM');
      }
    }
    const err = new CustomError();
    expect(exitCodeFor(err)).toBe(2);
  });
});
