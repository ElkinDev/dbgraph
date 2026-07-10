/**
 * DOG-3 C.5 — SQLite has NO dependency/view-column catalog. View `depends_on` edges are
 * already body-derived at `confidence: 'parsed'` (object grain); DOG-3 keeps them
 * BYTE-IDENTICAL: degradation is expressed by ABSENCE of `attrs.dstColumns` (Model A / design
 * D4 — NO per-edge marker), documented by `supportsColumnLineage: false`.
 *
 * Because sqlite's map.ts NEVER populated `RawDependency.columns` (untouched by Batch A/B),
 * this is a PURE capability-flag addition — the view edges were ALREADY object grain before
 * this commit; these tests PIN that fact so a future accidental body-parse regression is caught.
 *
 * Spec: sqlite-extraction "View column lineage degrades by absence" (all 3 scenarios);
 * graph-model "Per-engine column provenance and honest degradation-by-absence". D4.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import { buildRawCatalog } from '../../../../src/adapters/engines/sqlite/map.js';
import { betterSqliteDriver } from '../../../../src/adapters/engines/sqlite/driver.js';
import { SQLITE_CAPABILITIES } from '../../../../src/adapters/engines/sqlite/capabilities.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';

let mat: MaterializedDb;

beforeAll(() => {
  mat = materializeTorture();
});

afterAll(() => {
  mat.cleanup();
});

describe('SQLITE_CAPABILITIES — supportsColumnLineage is false (no dependency/view-column catalog)', () => {
  it('supportsColumnLineage is false', () => {
    expect(SQLITE_CAPABILITIES.supportsColumnLineage).toBe(false);
  });
});

describe('sqlite views keep object-grain depends_on, ZERO dstColumns, byte-identical (D4)', () => {
  it('active_departments and employee_summary depends_on edges carry NO attrs.dstColumns, confidence parsed', () => {
    const db = new Database(mat.path, { readonly: true });
    const driver = betterSqliteDriver(db);
    const catalog = buildRawCatalog(driver, { levels: DEFAULT_LEVELS });
    driver.close();

    const activeDept = catalog.objects.find((o) => o.kind === 'view' && o.name === 'active_departments');
    const empSummary = catalog.objects.find((o) => o.kind === 'view' && o.name === 'employee_summary');
    expect(activeDept).toBeDefined();
    expect(empSummary).toBeDefined();

    for (const view of [activeDept!, empSummary!]) {
      const deps = view.dependencies ?? [];
      expect(deps.length).toBeGreaterThanOrEqual(1);
      for (const dep of deps) {
        expect('columns' in dep).toBe(false);
        expect(dep.columns).toBeUndefined();
        expect(dep.confidence).toBe('parsed');
      }
    }

    // EXACT target sets, matching the sqlite-extraction spec scenario verbatim.
    const targets = (deps: readonly { target: { schema: string | null; name: string } }[]) =>
      deps.map((d) => `${d.target.schema}.${d.target.name}`).sort();
    expect(targets(activeDept!.dependencies ?? [])).toStrictEqual(['main.departments', 'main.employees']);
    expect(targets(empSummary!.dependencies ?? [])).toStrictEqual(['main.departments', 'main.employees']);
  });

  it('no body-parsed column is fabricated (negative, ADR-007) even though the bodies name specific columns', () => {
    const db = new Database(mat.path, { readonly: true });
    const driver = betterSqliteDriver(db);
    const catalog = buildRawCatalog(driver, { levels: DEFAULT_LEVELS });
    driver.close();

    for (const name of ['active_departments', 'employee_summary']) {
      const view = catalog.objects.find((o) => o.kind === 'view' && o.name === name)!;
      for (const dep of view.dependencies ?? []) {
        expect(dep.columns).toBeUndefined();
      }
    }
  });
});
