/**
 * Tests for dispatch table — task 2.2 (phase-4-cli-config).
 * Spec: cli-config "CLI exit codes are a stable contract" — unknown command → usage+exit 2.
 * Design Decision 4: dispatch maps command → handler; unknown command is a DispatchResult,
 * NOT a raw Error throw.
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */

import { describe, it, expect } from 'vitest';
import { dispatch, type DispatchResult } from '../../src/cli/dispatch.js';

// ─────────────────────────────────────────────────────────────────────────────
// Known commands map to a handler
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch — known commands', () => {
  it('dispatches "init" to a handler function', () => {
    const result = dispatch('init');
    expect(result.type).toBe('handler');
    if (result.type === 'handler') {
      expect(typeof result.handler).toBe('function');
    }
  });

  it('dispatches "sync" to a handler function', () => {
    const result = dispatch('sync');
    expect(result.type).toBe('handler');
  });

  it('dispatches "status" to a handler function', () => {
    const result = dispatch('status');
    expect(result.type).toBe('handler');
  });

  it('dispatches "query" to a handler function', () => {
    const result = dispatch('query');
    expect(result.type).toBe('handler');
  });

  it('dispatches "explore" to a handler function', () => {
    const result = dispatch('explore');
    expect(result.type).toBe('handler');
  });

  it('dispatches "diff" to a handler function', () => {
    const result = dispatch('diff');
    expect(result.type).toBe('handler');
  });

  it('each known command returns a different handler reference', () => {
    const init = dispatch('init');
    const sync = dispatch('sync');
    if (init.type === 'handler' && sync.type === 'handler') {
      expect(init.handler).not.toBe(sync.handler);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown command is flagged (not thrown as raw Error)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch — unknown command', () => {
  it('returns type "unknown" for an unrecognised command', () => {
    const result = dispatch('bogus');
    expect(result.type).toBe('unknown');
  });

  it('returns type "unknown" for empty string command', () => {
    const result = dispatch('');
    expect(result.type).toBe('unknown');
  });

  it('does NOT throw for unknown command', () => {
    expect(() => dispatch('this-does-not-exist')).not.toThrow();
  });

  it('DispatchResult for unknown carries the command name', () => {
    const result = dispatch('foobar') as DispatchResult & { type: 'unknown' };
    expect(result.command).toBe('foobar');
  });

  it('unknown result carries expected type literal', () => {
    const result = dispatch('xyz');
    expect(result.type).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return type is discriminated union
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch — return type shape', () => {
  it('handler result has .type === "handler" and .handler function', () => {
    const result = dispatch('status');
    expect(result.type).toBe('handler');
    if (result.type === 'handler') {
      expect(typeof result.handler).toBe('function');
    }
  });

  it('unknown result has .type === "unknown" and .command string', () => {
    const result = dispatch('nope');
    expect(result.type).toBe('unknown');
    if (result.type === 'unknown') {
      expect(typeof result.command).toBe('string');
    }
  });
});
