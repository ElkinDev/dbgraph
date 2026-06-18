/**
 * Tests for src/core/present/status.ts — task 1.7 (phase-5-mcp-server).
 * Spec: dbgraph_status index trust and live drift (connectionless half).
 * Design: formatStatus(McpStatusView) PURE; engine/version, last sync, per-type counts,
 *   configured levels, excluded objects, drift line ("could not be checked live" when no conn).
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 * ADR-008: deterministic output, byte-identical on re-run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatStatus,
  type McpStatusView,
  type StatusDetail,
} from '../../../src/core/present/status.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CONNECTIONLESS_VIEW: McpStatusView = {
  engine: 'SQLite',
  engineVersion: '3.42.0',
  lastSync: '2024-01-15T10:30:00Z',
  counts: { table: 12, view: 3, procedure: 5, trigger: 2, index: 8 },
  levels: { tables: 'full', views: 'metadata', procedures: 'metadata', triggers: 'full' },
  excludedObjects: ['dbo.sys_internal', 'dbo.tmp_cache'],
  driftChecked: false,
  driftDetected: null,
};

const DRIFT_DETECTED_VIEW: McpStatusView = {
  ...CONNECTIONLESS_VIEW,
  driftChecked: true,
  driftDetected: true,
};

const NO_DRIFT_VIEW: McpStatusView = {
  ...CONNECTIONLESS_VIEW,
  driftChecked: true,
  driftDetected: false,
};

const NO_SYNC_VIEW: McpStatusView = {
  engine: 'SQLite',
  engineVersion: undefined,
  lastSync: null,
  counts: {},
  levels: {},
  excludedObjects: [],
  driftChecked: false,
  driftDetected: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — content', () => {
  it('includes engine name', () => {
    const output = formatStatus(CONNECTIONLESS_VIEW, 'normal');
    expect(output).toContain('SQLite');
  });

  it('includes engine version when present', () => {
    const output = formatStatus(CONNECTIONLESS_VIEW, 'normal');
    expect(output).toContain('3.42.0');
  });

  it('includes last sync timestamp', () => {
    const output = formatStatus(CONNECTIONLESS_VIEW, 'normal');
    expect(output).toContain('2024-01-15T10:30:00Z');
  });

  it('shows "never" when lastSync is null', () => {
    const output = formatStatus(NO_SYNC_VIEW, 'normal');
    expect(output).toContain('never');
  });

  it('normal: includes per-type counts', () => {
    const output = formatStatus(CONNECTIONLESS_VIEW, 'normal');
    expect(output).toContain('12'); // table count
    expect(output).toContain('table');
  });

  it('normal: includes configured levels', () => {
    const output = formatStatus(CONNECTIONLESS_VIEW, 'normal');
    expect(output).toContain('metadata');
    expect(output).toContain('procedures');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drift reporting
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — drift', () => {
  it('connectionless: states drift could not be checked live', () => {
    const output = formatStatus(CONNECTIONLESS_VIEW, 'brief');
    expect(output).toContain('could not be checked live');
  });

  it('drift detected: reports drift detected', () => {
    const output = formatStatus(DRIFT_DETECTED_VIEW, 'brief');
    expect(output).toContain('detected');
  });

  it('no drift: reports none detected', () => {
    const output = formatStatus(NO_DRIFT_VIEW, 'brief');
    expect(output).toContain('none detected');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full detail
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — full detail', () => {
  it('full: includes excluded objects', () => {
    const output = formatStatus(CONNECTIONLESS_VIEW, 'full');
    expect(output).toContain('dbo.sys_internal');
    expect(output).toContain('dbo.tmp_cache');
  });

  it('full: shows (none) when no excluded objects', () => {
    const output = formatStatus(NO_SYNC_VIEW, 'full');
    expect(output).toContain('(none)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity contract
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — purity contract', () => {
  it('returns a string ending with a newline', () => {
    const levels: StatusDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(formatStatus(CONNECTIONLESS_VIEW, level)).toMatch(/\n$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — determinism (ADR-008)', () => {
  const levels: StatusDetail[] = ['brief', 'normal', 'full'];
  for (const level of levels) {
    it(`same input → byte-identical output (${level})`, () => {
      const run1 = formatStatus(CONNECTIONLESS_VIEW, level);
      const run2 = formatStatus(CONNECTIONLESS_VIEW, level);
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — goldens', () => {
  const levels: StatusDetail[] = ['brief', 'normal', 'full'];

  for (const level of levels) {
    it(`${level} output matches golden`, () => {
      const actual = formatStatus(CONNECTIONLESS_VIEW, level);
      const goldenPath = join(goldenDir, `status-${level}.txt`);
      const golden = readFileSync(goldenPath, 'utf-8');
      expect(actual).toBe(golden);
    });
  }
});
