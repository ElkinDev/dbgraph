/**
 * DOG-1 B.4 — pg `calls` edges, L-009 exact-set over the BUILT (offline) torture graph.
 *
 * Builds the pg RawCatalog from the committed row fixtures (which now carry the neutral
 * routine pair app.fn_wrapper → app.fn_inner), normalizes it OFFLINE (no container), and
 * pins the `parsed` `calls` edge with EXACT sets + explicit negatives. This is the
 * default-CI vehicle for pg-extraction S19/S22 and graph-model "pg/mysql calls is parsed"
 * (S4 parsed side).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPgRawCatalog, type PgRowInput } from '../../../../src/adapters/engines/pg/map.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import type { EdgeKind } from '../../../../src/core/model/edge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, '../../../fixtures/pg/rows');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf-8')) as T;
}

const FULL_SCOPE: ExtractionScope = {
  levels: { ...DEFAULT_LEVELS, tables: 'full', views: 'full', functions: 'full', procedures: 'full', triggers: 'full', sequences: 'full' },
};

function buildInput(): PgRowInput {
  return {
    schemas: loadFixture('schemas'),
    tables: loadFixture('tables'),
    columns: loadFixture('columns'),
    columnNames: loadFixture('column-names'),
    constraints: loadFixture('constraints'),
    indexes: loadFixture('indexes'),
    views: loadFixture('views'),
    routines: loadFixture('routines'),
    triggers: loadFixture('triggers'),
    sequences: loadFixture('sequences'),
  };
}

const norm: NormalizationResult = normalizeCatalog(buildPgRawCatalog(buildInput(), FULL_SCOPE), FULL_SCOPE);
const idToQName = new Map(norm.graph.nodes.map((n) => [n.id, n.qname]));

function pairs(kind: EdgeKind): Set<string> {
  return new Set(
    norm.graph.edges
      .filter((e) => e.kind === kind)
      .map((e) => `${idToQName.get(e.src) ?? e.src}→${idToQName.get(e.dst) ?? e.dst}`),
  );
}

function conf(kind: EdgeKind): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of norm.graph.edges.filter((x) => x.kind === kind)) {
    m.set(`${idToQName.get(e.src)}→${idToQName.get(e.dst)}`, e.confidence);
  }
  return m;
}

describe('pg normalize — calls edges (L-009 exact set, S19/S22)', () => {
  it('calls edges are EXACTLY { app.fn_wrapper → app.fn_inner }', () => {
    expect(pairs('calls')).toStrictEqual(new Set(['app.fn_wrapper→app.fn_inner']));
  });

  it('the fn_wrapper → fn_inner calls edge carries confidence parsed', () => {
    expect(conf('calls').get('app.fn_wrapper→app.fn_inner')).toBe('parsed');
  });

  it('NEGATIVE: no self-`calls` edge (fn_wrapper→fn_wrapper / fn_inner→fn_inner absent)', () => {
    const set = pairs('calls');
    expect(set.has('app.fn_wrapper→app.fn_wrapper')).toBe(false);
    expect(set.has('app.fn_inner→app.fn_inner')).toBe(false);
  });

  it('NEGATIVE: no reads_from/writes_to edge from fn_wrapper to fn_inner (the call is not a read/write)', () => {
    const rw = new Set([...pairs('reads_from'), ...pairs('writes_to')]);
    expect(rw.has('app.fn_wrapper→app.fn_inner')).toBe(false);
  });

  it('fn_inner reads app.orders (parsed) and emits ZERO calls edges', () => {
    expect(pairs('reads_from').has('app.fn_inner→app.orders')).toBe(true);
    expect(conf('reads_from').get('app.fn_inner→app.orders')).toBe('parsed');
    const fromInner = [...pairs('calls')].filter((p) => p.startsWith('app.fn_inner→'));
    expect(fromInner).toStrictEqual([]);
  });

  it('regression: no missing stub is minted for either routine qname', () => {
    expect(norm.stubs.filter((s) => s.qname === 'app.fn_wrapper')).toStrictEqual([]);
    expect(norm.stubs.filter((s) => s.qname === 'app.fn_inner')).toStrictEqual([]);
    expect(norm.stubs.filter((s) => s.reason === 'missing')).toStrictEqual([]);
  });
});
