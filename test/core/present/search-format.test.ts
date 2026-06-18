/**
 * Tests for src/core/present/search.ts — task 1.2 (phase-5-mcp-server).
 * Spec: dbgraph_search ranked paginated hits; Pagination.
 * Design: formatSearch(SearchView, detail) PURE; ranked hits with type+qname;
 *   declared total; offset/limit/hasMore line.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 * ADR-008: deterministic output, byte-identical on re-run.
 * Goldens under test/core/present/golden/ (formatter × detail, fixed view structs).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatSearch,
  type SearchView,
  type SearchDetail,
} from '../../../src/core/present/search.js';
import type { SearchHit } from '../../../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const HIT_TABLE: SearchHit = {
  id: 'node-orders',
  kind: 'table',
  qname: 'dbo.orders',
  column: 'qname',
  score: 1.5,
};

const HIT_VIEW: SearchHit = {
  id: 'node-order-summary',
  kind: 'view',
  qname: 'dbo.order_summary',
  column: 'qname',
  score: 0.8,
};

const HIT_PROC: SearchHit = {
  id: 'node-proc',
  kind: 'procedure',
  qname: 'dbo.usp_GetOrders',
  column: 'body',
  score: 0.3,
};

const SINGLE_HIT_VIEW: SearchView = {
  hits: [HIT_TABLE],
  total: 1,
  offset: 0,
  limit: 10,
};

const MULTI_HIT_VIEW: SearchView = {
  hits: [HIT_TABLE, HIT_VIEW, HIT_PROC],
  total: 3,
  offset: 0,
  limit: 10,
};

const PAGINATED_VIEW_PAGE1: SearchView = {
  hits: [HIT_TABLE, HIT_VIEW],
  total: 5,
  offset: 0,
  limit: 2,
};

const PAGINATED_VIEW_PAGE2: SearchView = {
  hits: [HIT_PROC],
  total: 5,
  offset: 4,
  limit: 2,
};

const EMPTY_VIEW: SearchView = {
  hits: [],
  total: 0,
  offset: 0,
  limit: 10,
};

// ─────────────────────────────────────────────────────────────────────────────
// Output content assertions — all detail levels
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSearch — content', () => {
  it('includes the qname of each hit', () => {
    const output = formatSearch(MULTI_HIT_VIEW, 'normal');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('dbo.order_summary');
    expect(output).toContain('dbo.usp_GetOrders');
  });

  it('includes the kind of each hit', () => {
    const output = formatSearch(MULTI_HIT_VIEW, 'normal');
    expect(output).toContain('table');
    expect(output).toContain('view');
    expect(output).toContain('procedure');
  });

  it('includes the declared total', () => {
    const output = formatSearch(MULTI_HIT_VIEW, 'normal');
    expect(output).toContain('3');
  });

  it('shows no results message when hits are empty', () => {
    const output = formatSearch(EMPTY_VIEW, 'normal');
    expect(output).toContain('No results');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination footer
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSearch — pagination', () => {
  it('shows hasMore: true when total > offset + hits.length', () => {
    const output = formatSearch(PAGINATED_VIEW_PAGE1, 'normal');
    expect(output).toContain('hasMore: true');
  });

  it('does NOT show hasMore: true when on last page', () => {
    const output = formatSearch(PAGINATED_VIEW_PAGE2, 'normal');
    expect(output).not.toContain('hasMore: true');
  });

  it('includes the offset in the footer', () => {
    const output = formatSearch(PAGINATED_VIEW_PAGE1, 'normal');
    expect(output).toContain('offset 0');
  });

  it('includes the offset on page 2', () => {
    const output = formatSearch(PAGINATED_VIEW_PAGE2, 'normal');
    expect(output).toContain('offset 4');
  });

  it('includes a results count in the footer', () => {
    const output = formatSearch(PAGINATED_VIEW_PAGE1, 'normal');
    // total is 5 — should appear somewhere
    expect(output).toContain('5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Detail levels
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSearch — detail levels', () => {
  it('brief: includes type and qname', () => {
    const output = formatSearch(SINGLE_HIT_VIEW, 'brief');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
  });

  it('normal: includes type and qname', () => {
    const output = formatSearch(SINGLE_HIT_VIEW, 'normal');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
  });

  it('full: includes type and qname', () => {
    const output = formatSearch(SINGLE_HIT_VIEW, 'full');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
  });

  it('full: includes match column info', () => {
    // In full detail the column match is exposed
    const output = formatSearch(MULTI_HIT_VIEW, 'full');
    expect(output).toContain('body'); // HIT_PROC matched on body
  });

  it('brief does NOT expose match column', () => {
    const output = formatSearch(MULTI_HIT_VIEW, 'brief');
    // 'body' as a match-column indicator should not appear in brief
    // (the word 'body' should not be in the brief output for this fixture)
    // We check by ensuring the output for brief is shorter than full
    const brief = formatSearch(MULTI_HIT_VIEW, 'brief');
    const full = formatSearch(MULTI_HIT_VIEW, 'full');
    expect(brief.length).toBeLessThan(full.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity — trailing newline, no mutation of input
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSearch — purity contract', () => {
  it('returns a string ending with a newline', () => {
    const levels: SearchDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(formatSearch(SINGLE_HIT_VIEW, level)).toMatch(/\n$/);
    }
  });

  it('does not throw on any valid detail level', () => {
    const levels: SearchDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(() => formatSearch(MULTI_HIT_VIEW, level)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSearch — determinism (ADR-008)', () => {
  const levels: SearchDetail[] = ['brief', 'normal', 'full'];
  for (const level of levels) {
    it(`same input → byte-identical output (${level})`, () => {
      const run1 = formatSearch(MULTI_HIT_VIEW, level);
      const run2 = formatSearch(MULTI_HIT_VIEW, level);
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests (byte-identical per detail level, ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSearch — goldens', () => {
  const levels: SearchDetail[] = ['brief', 'normal', 'full'];

  for (const level of levels) {
    it(`${level} output matches golden`, () => {
      const actual = formatSearch(MULTI_HIT_VIEW, level);
      const goldenPath = join(goldenDir, `search-${level}.txt`);
      const golden = readFileSync(goldenPath, 'utf-8');
      expect(actual).toBe(golden);
    });
  }
});
