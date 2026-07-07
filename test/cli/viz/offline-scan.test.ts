/**
 * Task 3.6 — RED→GREEN: structural pins on the emitted HTML.
 *
 * (a) OFFLINE  — the emitted file contains NO network-fetching construct (remote
 *     src/href, @import, url(http, fetch(, import(, XMLHttpRequest, Worker, EventSource);
 *     any literal http(s):// present is inert embedded text (the vendored d3 attribution
 *     comment), never a fetched resource.
 * (b) DATA-BLOCK — parsing `#dbgraph-data` out of the HTML deep-equals the B1 data-block
 *     golden, and two exports embed a BYTE-IDENTICAL block (ADR-008).
 * (c) SECRETS  — exporting with a resolved-secret sentinel + a sampled-value sentinel in
 *     the environment leaves BOTH absent from the HTML; only schema identifiers are embedded.
 *
 * Spec `graph-viz`: "emitted HTML fetches nothing at view time", "same graph yields a
 * byte-identical data block", "sentinel secret and sampled value never appear in the output".
 * L-009: toStrictEqual / toBe, no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVizExport, parseVizOptions } from '../../../src/cli/commands/viz.js';
import { openFixtureStore, type FixtureStore } from '../../mcp/fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const dataBlockGoldenPath = join(repoRoot, 'test', 'core', 'viz', 'golden', 'data-block-torture.json');

let fx: FixtureStore;
beforeAll(async () => { fx = await openFixtureStore(); });
afterAll(async () => { await fx.cleanup(); });

/** Network-fetching constructs that MUST NOT appear in an offline, air-gap-safe file. */
const FETCH_PATTERNS: ReadonlyArray<readonly [name: string, re: RegExp]> = [
  ['remote src=', /\bsrc\s*=\s*["']https?:/i],
  ['remote href=', /\bhref\s*=\s*["']https?:/i],
  ['@import', /@import/i],
  ['url(http', /url\(\s*["']?https?:/i],
  ['fetch(', /\bfetch\s*\(/],
  ['dynamic import(', /\bimport\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['Worker(', /\bnew\s+Worker\s*\(/],
  ['EventSource', /\bEventSource\b/],
];

describe('offline structural scan (task 3.6a)', () => {
  it('the emitted HTML contains NO network-fetching construct', async () => {
    const { content } = await buildVizExport(fx.store, parseVizOptions({}));
    const hits: string[] = [];
    for (const [name, re] of FETCH_PATTERNS) {
      if (re.test(content)) hits.push(name);
    }
    expect(hits).toStrictEqual([]);
  });

  it('every literal http(s):// occurrence is inert text (the vendored d3 attribution), not a fetch', async () => {
    const { content } = await buildVizExport(fx.store, parseVizOptions({}));
    const urls = content.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
    // there ARE inert URLs (the d3js.org attribution comments) — assert every one is a
    // d3js.org / github.com attribution, never a resource pulled by a fetching construct.
    for (const u of urls) {
      expect(/^https?:\/\/(d3js\.org|github\.com\/d3)/.test(u)).toBe(true);
    }
  });
});

describe('embedded data block extraction (task 3.6b)', () => {
  function extractBlock(html: string): unknown {
    const m = html.match(/<script id="dbgraph-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (m === null || m[1] === undefined) throw new Error('data block not found');
    return JSON.parse(m[1]);
  }

  it('parsed #dbgraph-data deep-equals the B1 data-block golden', async () => {
    const { content } = await buildVizExport(fx.store, parseVizOptions({}));
    const parsed = extractBlock(content);
    const golden = JSON.parse(readFileSync(dataBlockGoldenPath, 'utf-8'));
    expect(parsed).toStrictEqual(golden);
  });

  it('two exports embed a BYTE-IDENTICAL data block (ADR-008)', async () => {
    const a = await buildVizExport(fx.store, parseVizOptions({}));
    const b = await buildVizExport(fx.store, parseVizOptions({}));
    const blockA = a.content.match(/<script id="dbgraph-data"[^>]*>([\s\S]*?)<\/script>/)![1];
    const blockB = b.content.match(/<script id="dbgraph-data"[^>]*>([\s\S]*?)<\/script>/)![1];
    expect(blockB).toBe(blockA);
  });
});

describe('secrets / sampled values never embedded (task 3.6c)', () => {
  it('resolved-secret and sampled-value sentinels are absent from the emitted HTML', async () => {
    const secretSentinel = 'SUPERSECRET_CONNSTRING_SENTINEL_9f3a2b';
    const sampledSentinel = 'SAMPLED_ROW_VALUE_SENTINEL_7c1d4e';
    const prevSecret = process.env['DBGRAPH_TEST_SECRET'];
    const prevSample = process.env['DBGRAPH_TEST_SAMPLE'];
    process.env['DBGRAPH_TEST_SECRET'] = secretSentinel;
    process.env['DBGRAPH_TEST_SAMPLE'] = sampledSentinel;
    try {
      const { content } = await buildVizExport(fx.store, parseVizOptions({}));
      expect(content.includes(secretSentinel)).toBe(false);
      expect(content.includes(sampledSentinel)).toBe(false);
      // only schema identifiers are embedded — a known qname IS present
      expect(content).toContain('main.employees');
    } finally {
      if (prevSecret === undefined) delete process.env['DBGRAPH_TEST_SECRET'];
      else process.env['DBGRAPH_TEST_SECRET'] = prevSecret;
      if (prevSample === undefined) delete process.env['DBGRAPH_TEST_SAMPLE'];
      else process.env['DBGRAPH_TEST_SAMPLE'] = prevSample;
    }
  });
});
