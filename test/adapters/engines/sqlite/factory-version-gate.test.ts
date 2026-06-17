/**
 * S-2 remediation: make the node:sqlite version-gate test genuinely testable
 * on ANY Node runtime, not just on Node < 22.5.
 *
 * The original factory.test.ts:69-85 was a no-op on Node >= 22.5 — it opened
 * the adapter successfully (node:sqlite is available) and never exercised the
 * version-gate ConnectionError path.
 *
 * Fix: vi.mock the driver module so isNodeSqliteAvailable() returns false,
 * simulating an old-Node environment. The factory calls isNodeSqliteAvailable()
 * in openWithNodeSqlite() and throws ConnectionError when it returns false.
 * This assertion passes on ANY runtime, including Node 22.x and 24.x.
 *
 * TDD: RED (on Node >=22.5 the old test never reached the error path) →
 * GREEN (mock makes the gate fire deterministically on every CI matrix row).
 *
 * Design §2 D2: "Driver selection explicit, no silent fallback. node:sqlite
 * requires Node >= 22.5; requesting it on an older runtime throws ConnectionError
 * with an actionable message."
 *
 * US-026 (schema-extraction), US-031 (read-only by construction).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Spy on isNodeSqliteAvailable in the driver module ───────────────────────
// We spy before importing the factory so that the factory's imported reference
// (betterSqliteDriver / nodeSqliteDriver / isNodeSqliteAvailable from './driver.js')
// picks up the spy via the module's live binding.
//
// vi.mock with factory is hoisted; however for this test we want to spy only on
// isNodeSqliteAvailable (not the whole module), so we use vi.spyOn after import
// and reset between tests.
import * as driverModule from '../../../../src/adapters/engines/sqlite/driver.js';
import { createSqliteSchemaAdapter } from '../../../../src/adapters/engines/sqlite/factory.js';
import { ConnectionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// S-2 — Version gate fires a typed ConnectionError on simulated old Node
// ─────────────────────────────────────────────────────────────────────────────

describe("createSqliteSchemaAdapter() — node:sqlite version gate (S-2)", () => {
  let spy: MockInstance<() => boolean>;

  beforeEach(() => {
    // Simulate Node < 22.5 by making isNodeSqliteAvailable() return false.
    spy = vi.spyOn(driverModule, 'isNodeSqliteAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('throws ConnectionError (E_CONNECTION) when node:sqlite is requested on simulated old Node', async () => {
    const file = join(tmpdir(), 'any.db');
    await expect(
      createSqliteSchemaAdapter({ file, driver: 'node:sqlite' }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });

  it('ConnectionError message mentions node:sqlite requires Node >= 22.5', async () => {
    // Design D2: the error must be actionable — it must name the version requirement.
    const file = join(tmpdir(), 'any.db');
    await expect(
      createSqliteSchemaAdapter({ file, driver: 'node:sqlite' }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError &&
        e.message.includes('22.5'),
    );
  });

  it('ConnectionError message mentions upgrade or alternative driver', async () => {
    // The message must be actionable — it names what to do.
    // factory.ts produces: "Driver 'node:sqlite' requires Node.js >= 22.5. …
    //   Use driver: 'better-sqlite3' or upgrade Node.js."
    const file = join(tmpdir(), 'any.db');
    await expect(
      createSqliteSchemaAdapter({ file, driver: 'node:sqlite' }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError &&
        (e.message.includes('better-sqlite3') || e.message.includes('upgrade')),
    );
  });

  it('isNodeSqliteAvailable spy is called (mock exercises real factory code path)', async () => {
    const file = join(tmpdir(), 'any.db');
    try {
      await createSqliteSchemaAdapter({ file, driver: 'node:sqlite' });
    } catch {
      // expected
    }
    expect(spy).toHaveBeenCalled();
  });
});
