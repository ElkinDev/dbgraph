/**
 * Tests for SQLITE_CAPABILITIES — the truthful CapabilityMatrix for SQLite.
 * Design §3 "CapabilityMatrix (truthful SQLite)".
 * Story: sqlite-extraction "Truthful SQLite CapabilityMatrix" (US-026).
 * TDD: RED → fails until src/adapters/engines/sqlite/capabilities.ts is created.
 */

import { describe, it, expect } from 'vitest';
import { SQLITE_CAPABILITIES } from '../../../../src/adapters/engines/sqlite/capabilities.js';

// ─────────────────────────────────────────────────────────────────────────────
// Supported types — SQLite CAN extract these
// ─────────────────────────────────────────────────────────────────────────────

describe('SQLITE_CAPABILITIES — supported types', () => {
  it('engine identifier is sqlite', () => {
    expect(SQLITE_CAPABILITIES.engine).toBe('sqlite');
  });

  it('declares schema as supported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('schema')).toBe(true);
  });

  it('declares table as supported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('table')).toBe(true);
  });

  it('declares column as supported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('column')).toBe(true);
  });

  it('declares constraint as supported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('constraint')).toBe(true);
  });

  it('declares index as supported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('index')).toBe(true);
  });

  it('declares view as supported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('view')).toBe(true);
  });

  it('declares trigger as supported', () => {
    expect(SQLITE_CAPABILITIES.supported.has('trigger')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported types — SQLite has NO procedures, functions, sequences, collections
// ─────────────────────────────────────────────────────────────────────────────

describe('SQLITE_CAPABILITIES — unsupported types', () => {
  it('procedure is NOT in supported set', () => {
    expect(SQLITE_CAPABILITIES.supported.has('procedure')).toBe(false);
  });

  it('function is NOT in supported set', () => {
    expect(SQLITE_CAPABILITIES.supported.has('function')).toBe(false);
  });

  it('sequence is NOT in supported set', () => {
    expect(SQLITE_CAPABILITIES.supported.has('sequence')).toBe(false);
  });

  it('collection is NOT in supported set', () => {
    expect(SQLITE_CAPABILITIES.supported.has('collection')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Body and dependency hints flags
// ─────────────────────────────────────────────────────────────────────────────

describe('SQLITE_CAPABILITIES — body and dependency flags', () => {
  it('supportsBodies is true (view + trigger SQL from sqlite_master)', () => {
    expect(SQLITE_CAPABILITIES.supportsBodies).toBe(true);
  });

  it('supportsDependencyHints is false (declared blindness, US-007)', () => {
    expect(SQLITE_CAPABILITIES.supportsDependencyHints).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultLevels is present and is an ObjectTypeLevels-shaped object
// ─────────────────────────────────────────────────────────────────────────────

describe('SQLITE_CAPABILITIES — defaultLevels present', () => {
  it('defaultLevels is an object', () => {
    expect(typeof SQLITE_CAPABILITIES.defaultLevels).toBe('object');
    expect(SQLITE_CAPABILITIES.defaultLevels).not.toBeNull();
  });

  it('defaultLevels.tables is a valid level string', () => {
    const validLevels = ['off', 'metadata', 'full'];
    expect(validLevels).toContain(SQLITE_CAPABILITIES.defaultLevels.tables);
  });
});
