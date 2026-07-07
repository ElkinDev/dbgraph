/**
 * Token budget assertions — task 5.4 / Batch E (phase-5-mcp-server).
 * Spec: "Brief detail respects the measured token budget / budgets measured on the torture fixture."
 * Design Decision 2: EMPIRICAL budgets pinned in docs/format-spec.md after measurement.
 *
 * This test asserts that the committed tool × detail golden files DO NOT exceed
 * the measured ceilings pinned in docs/format-spec.md. It verifies the spec's
 * "brief-budget assertion for a ≤30-relationship entity".
 *
 * The torture fixture entity used is main.employees which has ≤ 30 relationships.
 * Golden files are the source of truth for byte-identical measurement (ADR-008).
 *
 * Ceilings from docs/format-spec.md (ceil(chars/4) with ~25-50% headroom):
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mcpGoldenDir = resolve(__dirname, '../../mcp/golden');

// ─────────────────────────────────────────────────────────────────────────────
// Token budget ceilings (from docs/format-spec.md — pinned in task 5.4)
// Formula: ceil(output_chars / 4)
// ─────────────────────────────────────────────────────────────────────────────

/** ceil(chars / 4) — the LLM tokenizer approximation. */
function charToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function readGolden(filename: string): string {
  return readFileSync(join(mcpGoldenDir, filename), 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Brief budget assertions — one per tool (the spec requires at least brief)
// ─────────────────────────────────────────────────────────────────────────────

describe('Token budget: brief detail respects the measured ceiling (≤30-relationship entity)', () => {
  it('dbgraph_explore brief ≤ 75 tokens', () => {
    const text = readGolden('explore-brief.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(75);
  });

  it('dbgraph_search brief ≤ 275 tokens', () => {
    const text = readGolden('search-tool-brief.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(275);
  });

  it('dbgraph_object brief ≤ 30 tokens', () => {
    const text = readGolden('object-tool-brief.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(30);
  });

  it('dbgraph_related brief ≤ 80 tokens', () => {
    const text = readGolden('related-tool-brief.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(80);
  });

  it('dbgraph_impact brief ≤ 50 tokens', () => {
    const text = readGolden('impact-tool-brief.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(50);
  });

  it('dbgraph_path (found) ≤ 80 tokens', () => {
    const text = readGolden('path-tool-found.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(80);
  });

  it('dbgraph_status brief ≤ 65 tokens (excludes variable timestamp from budget calc)', () => {
    // Status includes a non-deterministic ISO timestamp (~25 chars).
    // We measure the ceiling conservatively against the full output.
    const text = readGolden('status-tool-brief.txt');
    // The status brief golden includes the timestamp — ceiling accounts for it
    expect(charToTokens(text.length)).toBeLessThanOrEqual(65);
  });

  it('dbgraph_precheck brief ≤ 40 tokens', () => {
    const text = readGolden('precheck-tool-brief.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Normal budget assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('Token budget: normal detail respects the measured ceiling', () => {
  // explore-payloads re-measure (B.8): explore now emits per-kind payload sections.
  // RE-MEASURED on the torture fixture (ceil(chars/4)): explore normal = 342 tk
  // (was ~73 pre-payload) — still within the 400 ceiling, unchanged.
  it('dbgraph_explore normal ≤ 400 tokens', () => {
    const text = readGolden('explore-normal.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(400);
  });

  it('dbgraph_search normal ≤ 275 tokens', () => {
    const text = readGolden('search-tool-normal.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(275);
  });

  it('dbgraph_object normal ≤ 110 tokens', () => {
    const text = readGolden('object-tool-normal.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(110);
  });

  it('dbgraph_related normal ≤ 400 tokens', () => {
    const text = readGolden('related-tool-normal.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(400);
  });

  it('dbgraph_impact normal ≤ 55 tokens', () => {
    const text = readGolden('impact-tool-normal.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(55);
  });

  it('dbgraph_status normal ≤ 250 tokens', () => {
    const text = readGolden('status-tool-normal.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(250);
  });

  it('dbgraph_precheck normal ≤ 65 tokens', () => {
    const text = readGolden('precheck-tool-normal.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(65);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full budget assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('Token budget: full detail respects the measured ceiling', () => {
  // explore-payloads re-measure (B.8): explore full now emits COLUMNS + CONSTRAINTS
  // + INDEXES + TRIGGERS payload sections before the neighbor listing. RE-MEASURED
  // on the torture fixture (ceil(chars/4)): explore full = 439 tk (was ~76 pre-payload)
  // — this EXCEEDS the prior 420 ceiling, so the ceiling is WIDENED to 480 (≈9% headroom
  // over the measured 439). Paired with a docs/format-spec.md §6 token-delta note.
  it('dbgraph_explore full ≤ 480 tokens (re-measured after payload sections landed)', () => {
    const text = readGolden('explore-full.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(480);
  });

  it('dbgraph_search full ≤ 400 tokens', () => {
    const text = readGolden('search-tool-full.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(400);
  });

  it('dbgraph_object full ≤ 225 tokens', () => {
    const text = readGolden('object-tool-full.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(225);
  });

  it('dbgraph_related full ≤ 400 tokens', () => {
    const text = readGolden('related-tool-full.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(400);
  });

  it('dbgraph_impact full ≤ 55 tokens', () => {
    const text = readGolden('impact-tool-full.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(55);
  });

  it('dbgraph_status full ≤ 265 tokens', () => {
    const text = readGolden('status-tool-full.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(265);
  });

  it('dbgraph_precheck full ≤ 110 tokens', () => {
    const text = readGolden('precheck-tool-full.txt');
    expect(charToTokens(text.length)).toBeLessThanOrEqual(110);
  });
});
