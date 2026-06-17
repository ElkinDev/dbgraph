/**
 * RED+GREEN tests for W-3: trigger fires_on AND writes_to from a single fixture (US-007).
 * Spec ref: graph-normalization §"Trigger fires and writes"
 *   "AFTER UPDATE trigger on orders that writes to audit → fires_on(trigger→orders, UPDATE)
 *    AND writes_to(trigger→audit)"
 *
 * Fixture: test/fixtures/catalog-trigger-rw.json
 * Golden: test/golden/normalize/catalog-trigger-rw.json
 *
 * Strict TDD — RED: golden file does not exist yet; first run writes it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCatalog } from '../../../src/core/normalize/normalize.js';
import type { RawCatalog } from '../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../src/core/model/graph.js';

const FIXTURE_DIR = join(import.meta.dirname, '../../fixtures');
const GOLDEN_DIR = join(import.meta.dirname, '../../golden/normalize');

function loadFixture(name: string): RawCatalog {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as RawCatalog;
}

function serializeResult(result: NormalizationResult): string {
  return JSON.stringify(result, null, 2);
}

function assertMatchesGolden(name: string, result: NormalizationResult): void {
  const goldenPath = join(GOLDEN_DIR, `${name}.json`);
  const actual = serializeResult(result);
  if (!existsSync(goldenPath)) {
    writeFileSync(goldenPath, actual, 'utf8');
    return;
  }
  const expected = readFileSync(goldenPath, 'utf8');
  expect(actual).toBe(expected);
}

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'full',
    functions: 'full',
    triggers: 'full',
    sequences: 'metadata',
    collections: 'metadata',
    fields: 'metadata',
    statistics: 'off',
    sampling: 'off',
  },
};

describe('normalizeCatalog — catalog-trigger-rw (W-3: trigger fires_on AND writes_to)', () => {
  const raw = loadFixture('catalog-trigger-rw');
  const result = normalizeCatalog(raw, FULL_SCOPE);

  it('produces a trigger node for trg_orders_after_update_audit', () => {
    const trigger = result.graph.nodes.find((n) => n.kind === 'trigger');
    expect(trigger).toBeDefined();
    expect(trigger?.qname).toBe('dbo.trg_orders_after_update_audit');
  });

  it('produces fires_on(trigger → orders, event=UPDATE) edge', () => {
    const trigger = result.graph.nodes.find((n) => n.kind === 'trigger');
    const orders = result.graph.nodes.find((n) => n.qname === 'dbo.orders');
    expect(trigger).toBeDefined();
    expect(orders).toBeDefined();

    const firesOnEdge = result.graph.edges.find(
      (e) =>
        e.kind === 'fires_on' &&
        e.src === trigger!.id &&
        e.dst === orders!.id,
    );
    expect(firesOnEdge).toBeDefined();
    expect(firesOnEdge!.attrs.event).toBe('UPDATE');
  });

  it('produces writes_to(trigger → audit) edge from the SAME trigger', () => {
    const trigger = result.graph.nodes.find((n) => n.kind === 'trigger');
    const audit = result.graph.nodes.find((n) => n.qname === 'dbo.audit');
    expect(trigger).toBeDefined();
    expect(audit).toBeDefined();

    const writesToEdge = result.graph.edges.find(
      (e) =>
        e.kind === 'writes_to' &&
        e.src === trigger!.id &&
        e.dst === audit!.id,
    );
    expect(writesToEdge).toBeDefined();
    expect(writesToEdge!.confidence).toBe('parsed');
  });

  it('fires_on and writes_to both originate from the SAME trigger node', () => {
    const trigger = result.graph.nodes.find((n) => n.kind === 'trigger');
    expect(trigger).toBeDefined();

    const firesOnEdge = result.graph.edges.find((e) => e.kind === 'fires_on' && e.src === trigger!.id);
    const writesToEdge = result.graph.edges.find((e) => e.kind === 'writes_to' && e.src === trigger!.id);

    expect(firesOnEdge).toBeDefined();
    expect(writesToEdge).toBeDefined();
    // Both edges originate from the same trigger
    expect(firesOnEdge!.src).toBe(trigger!.id);
    expect(writesToEdge!.src).toBe(trigger!.id);
  });

  it('matches the golden file (byte-identical deterministic output)', () => {
    assertMatchesGolden('catalog-trigger-rw', result);
    const result2 = normalizeCatalog(raw, FULL_SCOPE);
    expect(serializeResult(result2)).toBe(serializeResult(result));
  });
});
