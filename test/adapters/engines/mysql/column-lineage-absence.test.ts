/**
 * DOG-3 C.5 — MySQL exposes NO view-column catalog. View `depends_on` edges STAY object grain,
 * BYTE-IDENTICAL to pre-DOG-3: degradation is expressed by ABSENCE of `attrs.dstColumns` (Model
 * A / design D4 — NO per-edge marker), documented by `supportsColumnLineage: false`.
 *
 * Because mysql's map.ts NEVER populated `RawDependency.columns` (untouched by Batch A/B), this
 * is a PURE capability-flag addition — the view edges were ALREADY object grain before this
 * commit; these tests PIN that fact so a future accidental body-parse regression is caught.
 *
 * Spec: mysql-extraction "View column lineage degrades by absence" (all 3 scenarios);
 * graph-model "Per-engine column provenance and honest degradation-by-absence". D4.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMysqlRawCatalog } from '../../../../src/adapters/engines/mysql/map.js';
import { MYSQL_CAPABILITIES } from '../../../../src/adapters/engines/mysql/capabilities.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '../../../fixtures/mysql/rows');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, `${name}.json`), 'utf-8')) as T;
}

const FULL_SCOPE: ExtractionScope = { levels: { ...DEFAULT_LEVELS, tables: 'full', views: 'full' } };

describe('MYSQL_CAPABILITIES — supportsColumnLineage is false (no view-column catalog)', () => {
  it('supportsColumnLineage is false', () => {
    expect(MYSQL_CAPABILITIES.supportsColumnLineage).toBe(false);
  });
});

function buildFixtureInput(): {
  database: string;
  tables: unknown; columns: unknown; pkUkColumns: unknown; fkColumns: unknown;
  checkConstraints: unknown; statistics: unknown; views: unknown; routines: unknown; triggers: unknown;
} {
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

describe('mysql view carries object-grain depends_on, ZERO dstColumns, byte-identical (D4)', () => {
  it('v_order_summary depends_on edges to orders/order_items carry NO attrs.dstColumns, confidence parsed', () => {
    const catalog = buildMysqlRawCatalog(buildFixtureInput() as never, FULL_SCOPE);
    const view = catalog.objects.find((o) => o.kind === 'view' && o.name === 'v_order_summary');
    expect(view).toBeDefined();
    const deps = view!.dependencies ?? [];
    expect(deps.length).toBeGreaterThanOrEqual(1);
    for (const dep of deps) {
      expect('columns' in dep).toBe(false);
      expect(dep.columns).toBeUndefined();
      expect(dep.confidence).toBe('parsed');
    }
  });

  it('no body-parsed column is fabricated (negative, ADR-007) even though the body names specific columns', () => {
    // v_order_summary's body literally names order_id/customer_id/status/item_id/total_price —
    // NONE of that MUST ever mint a columns entry (mysql has no catalog to source it from).
    const catalog = buildMysqlRawCatalog(buildFixtureInput() as never, FULL_SCOPE);
    const view = catalog.objects.find((o) => o.kind === 'view' && o.name === 'v_order_summary')!;
    for (const dep of view.dependencies ?? []) {
      expect(dep.columns).toBeUndefined();
    }
  });
});
