/**
 * DOG-2 1.6 — SQLite emits NO routine parameters (capability honestly absent).
 *
 * SQLite has no stored-procedure/function parameter catalog (and no routine objects at all
 * in the torture catalog) — its CapabilityMatrix declares procedures and functions
 * UNSUPPORTED. So NO RawObject carries a `parameters` field: it stays UNSET (undefined),
 * NOT [] — separating "unknown" (no parameter catalog) from "known-zero" (a real empty
 * signature on a SQL engine). Declared absence, never fabricated. No sqlite/* code change,
 * no fixture object added — this test PINS the honest absence over the EXISTING torture catalog.
 *
 * Spec: sqlite-extraction "SQLite emits no routine parameters" (SQ-1);
 *   schema-extraction "An engine without a parameter catalog leaves the field unset" (SE-2 unset half).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import { createSqliteSchemaAdapter } from '../../../../src/adapters/engines/sqlite/factory.js';
import { SQLITE_CAPABILITIES } from '../../../../src/adapters/engines/sqlite/capabilities.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawCatalog } from '../../../../src/core/model/catalog.js';

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };

let mat: MaterializedDb;
let catalog: RawCatalog;

beforeAll(async () => {
  mat = materializeTorture();
  const adapter = await createSqliteSchemaAdapter({ file: mat.path });
  catalog = await adapter.extract(FULL_SCOPE);
  await adapter.close();
});

afterAll(() => {
  mat.cleanup();
});

describe('SQLite torture catalog — no routine parameters (SQ-1, SE-2 unset half)', () => {
  it('the extraction actually ran (non-trivial GREEN guard)', () => {
    // sqlite DOES extract tables/views/triggers — just never a routine or a parameter.
    expect(catalog.objects.length).toBeGreaterThan(0);
    expect(catalog.objects.some((o) => o.kind === 'table')).toBe(true);
  });

  it('NO RawObject carries a parameters field — UNSET, never [] (honest absence)', () => {
    const withParams = catalog.objects.filter((o) => 'parameters' in o);
    expect(withParams).toStrictEqual([]);
    // And explicitly: every object reads back undefined (not an empty array).
    for (const o of catalog.objects) {
      expect(o.parameters).toBeUndefined();
    }
  });

  it('there is NO procedure or function object to carry parameters', () => {
    const routines = catalog.objects.filter(
      (o) => o.kind === 'procedure' || o.kind === 'function',
    );
    expect(routines).toStrictEqual([]);
  });

  it('the CapabilityMatrix still reports procedures and functions UNSUPPORTED (unchanged)', () => {
    expect(SQLITE_CAPABILITIES.supported.has('procedure')).toBe(false);
    expect(SQLITE_CAPABILITIES.supported.has('function')).toBe(false);
  });
});
