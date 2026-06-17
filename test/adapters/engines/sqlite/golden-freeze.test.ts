/**
 * Task 6.1 — RawCatalog golden freeze.
 * Generates (on first run) or verifies (on subsequent runs) that
 * extract() on the torture fixture produces byte-identical output
 * to the committed golden file.
 *
 * Design §testing "Torture fixture … same bytes every run → stable golden".
 * ADR-008: determinism — two independent calls must produce the same JSON.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import { buildRawCatalog } from '../../../../src/adapters/engines/sqlite/map.js';
import { betterSqliteDriver } from '../../../../src/adapters/engines/sqlite/driver.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_PATH = join(__dirname, '../../../fixtures/sqlite/golden-raw-catalog.json');

let mat: MaterializedDb;

beforeAll(() => {
  mat = materializeTorture();
});

afterAll(() => {
  mat.cleanup();
});

describe('RawCatalog golden freeze (task 6.1)', () => {
  it('extract produces deterministic stableStringify output (byte-identical on second call)', () => {
    const db1 = new Database(mat.path, { readonly: true });
    const driver1 = betterSqliteDriver(db1);
    const scope = { levels: DEFAULT_LEVELS };
    const catalog1 = buildRawCatalog(driver1, scope);
    driver1.close();

    const db2 = new Database(mat.path, { readonly: true });
    const driver2 = betterSqliteDriver(db2);
    const catalog2 = buildRawCatalog(driver2, scope);
    driver2.close();

    expect(stableStringify(catalog1)).toBe(stableStringify(catalog2));
  });

  it('golden file matches extract() output (or seeds golden on first run)', () => {
    const db = new Database(mat.path, { readonly: true });
    const driver = betterSqliteDriver(db);
    const scope = { levels: DEFAULT_LEVELS };
    const catalog = buildRawCatalog(driver, scope);
    driver.close();

    const actual = stableStringify(catalog);

    if (!existsSync(GOLDEN_PATH)) {
      // Seed mode: write golden for the first time
      writeFileSync(GOLDEN_PATH, actual, 'utf-8');
      console.log('[golden-freeze] Golden seeded at:', GOLDEN_PATH);
      console.log('[golden-freeze] Object count:', catalog.objects.length);
      // Pass: first run always seeds
      expect(actual.length).toBeGreaterThan(0);
      return;
    }

    // Verify mode: compare with committed golden
    const committed = readFileSync(GOLDEN_PATH, 'utf-8');
    if (actual !== committed) {
      // Provide useful diff info in the error
      const actualObj = JSON.parse(actual) as { objects: Array<{ kind: string; name: string }> };
      const committedObj = JSON.parse(committed) as { objects: Array<{ kind: string; name: string }> };
      expect.fail(
        `Golden mismatch!\n` +
          `Actual object count: ${actualObj.objects.length}\n` +
          `Golden object count: ${committedObj.objects.length}\n` +
          `Delete golden-raw-catalog.json to re-seed, or fix the extraction logic.`,
      );
    }
    expect(actual).toBe(committed);
  });
});
