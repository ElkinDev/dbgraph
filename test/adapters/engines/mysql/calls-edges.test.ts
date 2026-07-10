/**
 * DOG-1 B.4 — mysql `calls` edges, L-009 exact-set over the BUILT (offline) torture graph.
 *
 * Builds the mysql RawCatalog from the committed row fixtures (which now carry the neutral
 * routine pair app.proc_orchestrate → app.proc_step), normalizes it OFFLINE (no container),
 * and pins the `parsed` `calls` edge with EXACT sets + explicit negatives. Default-CI
 * vehicle for mysql-extraction S23/S26 and graph-model "pg/mysql calls is parsed" (S4).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMysqlRawCatalog, type MysqlRowInput } from '../../../../src/adapters/engines/mysql/map.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import type { EdgeKind } from '../../../../src/core/model/edge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, '../../../fixtures/mysql/rows');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf-8')) as T;
}

const FULL_SCOPE: ExtractionScope = {
  levels: { ...DEFAULT_LEVELS, tables: 'full', views: 'full', functions: 'full', procedures: 'full', triggers: 'full' },
};

function buildInput(): MysqlRowInput {
  return {
    database: 'app',
    tables: loadFixture('tables'),
    columns: loadFixture('columns'),
    pkUkColumns: loadFixture('pk-uk-columns'),
    fkColumns: loadFixture('fk-columns'),
    checkConstraints: loadFixture('check-constraints'),
    statistics: loadFixture('statistics'),
    views: loadFixture('views'),
    routines: loadFixture('routines'),
    triggers: loadFixture('triggers'),
  };
}

const norm: NormalizationResult = normalizeCatalog(buildMysqlRawCatalog(buildInput(), FULL_SCOPE), FULL_SCOPE);
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

describe('mysql normalize — calls edges (L-009 exact set, S23/S26)', () => {
  it('calls edges are EXACTLY { app.proc_orchestrate → app.proc_step }', () => {
    expect(pairs('calls')).toStrictEqual(new Set(['app.proc_orchestrate→app.proc_step']));
  });

  it('the proc_orchestrate → proc_step calls edge carries confidence parsed', () => {
    expect(conf('calls').get('app.proc_orchestrate→app.proc_step')).toBe('parsed');
  });

  it('NEGATIVE: no self-`calls` edge (proc_orchestrate→proc_orchestrate / proc_step→proc_step absent)', () => {
    const set = pairs('calls');
    expect(set.has('app.proc_orchestrate→app.proc_orchestrate')).toBe(false);
    expect(set.has('app.proc_step→app.proc_step')).toBe(false);
  });

  it('NEGATIVE: no reads_from/writes_to edge from proc_orchestrate to proc_step (the CALL is not a read/write)', () => {
    const rw = new Set([...pairs('reads_from'), ...pairs('writes_to')]);
    expect(rw.has('app.proc_orchestrate→app.proc_step')).toBe(false);
  });

  it('proc_step writes app.audit_log (parsed) and emits ZERO calls edges', () => {
    expect(pairs('writes_to').has('app.proc_step→app.audit_log')).toBe(true);
    expect(conf('writes_to').get('app.proc_step→app.audit_log')).toBe('parsed');
    const fromStep = [...pairs('calls')].filter((p) => p.startsWith('app.proc_step→'));
    expect(fromStep).toStrictEqual([]);
  });

  it('regression: no missing stub is minted for either routine qname', () => {
    expect(norm.stubs.filter((s) => s.qname === 'app.proc_orchestrate')).toStrictEqual([]);
    expect(norm.stubs.filter((s) => s.qname === 'app.proc_step')).toStrictEqual([]);
    expect(norm.stubs.filter((s) => s.reason === 'missing')).toStrictEqual([]);
  });
});
