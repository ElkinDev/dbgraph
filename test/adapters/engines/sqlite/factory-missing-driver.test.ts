/**
 * W-1 remediation: assert the actionable install-command message when the
 * better-sqlite3 dynamic import fails (MODULE_NOT_FOUND scenario).
 *
 * factory.ts lines 67-70 already build this message; this file proves it.
 *
 * Technique: vi.mock with a hoisted factory that throws a MODULE_NOT_FOUND-style
 * error. Because vi.mock is hoisted before imports, the module-under-test sees
 * the mock when it calls `await import('better-sqlite3')`.
 *
 * TDD: RED (test written first, verifying the message contract) → GREEN (factory
 * already implements it at factory.ts:67-70, so green after the mock lands).
 *
 * US-026 (schema-extraction Missing-driver-names-install-command scenario).
 */

import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Mock better-sqlite3 to simulate MODULE_NOT_FOUND ─────────────────────────
// vi.mock is hoisted by Vitest before any import, so the factory will see this
// when it tries `await import('better-sqlite3')`.
vi.mock('better-sqlite3', () => {
  const err = new Error("Cannot find module 'better-sqlite3'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  throw err;
});

// Import AFTER mock is registered (hoisting means this is fine in the module graph)
import { createSqliteSchemaAdapter } from '../../../../src/adapters/engines/sqlite/factory.js';
import { ConnectionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// W-1 — Missing driver names the exact install command
// ─────────────────────────────────────────────────────────────────────────────

describe("createSqliteSchemaAdapter() — missing driver 'better-sqlite3'", () => {
  it('throws ConnectionError (E_CONNECTION) when better-sqlite3 is not installed', async () => {
    const file = join(tmpdir(), 'any.db');
    await expect(
      createSqliteSchemaAdapter({ file }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });

  it('ConnectionError message names the exact install command "npm i better-sqlite3"', async () => {
    // Spec scenario: Missing-driver-names-install-command.
    // factory.ts:67-70 produces: "Required driver 'better-sqlite3' is not installed. Run: npm i better-sqlite3"
    const file = join(tmpdir(), 'any.db');
    await expect(
      createSqliteSchemaAdapter({ file }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError &&
        e.message.includes('npm i better-sqlite3'),
    );
  });

  it('ConnectionError message mentions the driver name', async () => {
    const file = join(tmpdir(), 'any.db');
    await expect(
      createSqliteSchemaAdapter({ file }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError &&
        e.message.includes('better-sqlite3'),
    );
  });
});
