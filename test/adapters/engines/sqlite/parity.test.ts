// Cross-driver parity test — task 8.1 (US-026, ADR-006).
// Asserts that better-sqlite3 and node:sqlite produce byte-identical RawCatalog
// output for the same materialized torture fixture.
// Skips with a documented reason on Node < 22.5.
//
// Design §testing "node:sqlite conditionality" and "Parity assertion".

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import { buildRawCatalog } from '../../../../src/adapters/engines/sqlite/map.js';
import {
  betterSqliteDriver,
  nodeSqliteDriver,
  isNodeSqliteAvailable,
} from '../../../../src/adapters/engines/sqlite/driver.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

const NODE_VERSION = process.versions['node'] ?? '0.0.0';
const SKIP_REASON = `node:sqlite requires Node >= 22.5; current: ${NODE_VERSION}`;

let mat: MaterializedDb;

beforeAll(() => {
  mat = materializeTorture();
});

afterAll(() => {
  mat.cleanup();
});

describe.skipIf(!isNodeSqliteAvailable())(
  `Cross-driver parity: better-sqlite3 vs node:sqlite [Node ${NODE_VERSION}]`,
  () => {
    it('both drivers produce byte-identical stableStringify(RawCatalog) for the same fixture', async () => {
      const scope = { levels: DEFAULT_LEVELS };

      // ── better-sqlite3 path ──────────────────────────────────────────────
      const bsqlDb = new Database(mat.path, { readonly: true });
      const bsqlDriver = betterSqliteDriver(bsqlDb);
      const catalogBetter = buildRawCatalog(bsqlDriver, scope);
      bsqlDriver.close();

      // ── node:sqlite path ─────────────────────────────────────────────────
      // Dynamic import — only safe because skipIf guard ensures Node >= 22.5
      const nodeSqlite = await import('node:sqlite');
      const DatabaseSync = (nodeSqlite as Record<string, unknown>)['DatabaseSync'] as new(
        path: string,
        opts?: Record<string, unknown>,
      ) => unknown;

      const nodeDb = new DatabaseSync(mat.path, { readOnly: true });
      const nodeDriver = nodeSqliteDriver(nodeDb);
      const catalogNode = buildRawCatalog(nodeDriver, scope);
      nodeDriver.close();

      // ── Assertion ────────────────────────────────────────────────────────
      const better = stableStringify(catalogBetter);
      const node = stableStringify(catalogNode);

      if (better !== node) {
        // Provide helpful diff context
        const betterObj = JSON.parse(better) as { objects: Array<{ kind: string; name: string }> };
        const nodeObj = JSON.parse(node) as { objects: Array<{ kind: string; name: string }> };
        expect.fail(
          `Driver parity violation!\n` +
            `better-sqlite3 objects: ${betterObj.objects.length}\n` +
            `node:sqlite objects: ${nodeObj.objects.length}\n` +
            `The extraction logic in map.ts produces different output per driver. ` +
            `Check ReadonlyDriver adapters in driver.ts.`,
        );
      }

      expect(better).toBe(node);
    });

    it('both drivers agree on object count and top-level schema fields', async () => {
      const scope = { levels: DEFAULT_LEVELS };

      const bsqlDb = new Database(mat.path, { readonly: true });
      const bsqlDriver = betterSqliteDriver(bsqlDb);
      const catalogBetter = buildRawCatalog(bsqlDriver, scope);
      bsqlDriver.close();

      const nodeSqlite = await import('node:sqlite');
      const DatabaseSync = (nodeSqlite as Record<string, unknown>)['DatabaseSync'] as new(
        path: string,
        opts?: Record<string, unknown>,
      ) => unknown;
      const nodeDb = new DatabaseSync(mat.path, { readOnly: true });
      const nodeDriver = nodeSqliteDriver(nodeDb);
      const catalogNode = buildRawCatalog(nodeDriver, scope);
      nodeDriver.close();

      expect(catalogNode.engine).toBe(catalogBetter.engine);
      expect(catalogNode.schemas).toEqual(catalogBetter.schemas);
      expect(catalogNode.objects.length).toBe(catalogBetter.objects.length);
    });
  },
);

// Document skip reason when node:sqlite is unavailable
if (!isNodeSqliteAvailable()) {
  describe('Cross-driver parity: SKIPPED', () => {
    it(`skipped with reason: ${SKIP_REASON}`, () => {
      console.log(`[parity] ${SKIP_REASON}`);
      // Not a failure — this is the documented skip
    });
  });
}
