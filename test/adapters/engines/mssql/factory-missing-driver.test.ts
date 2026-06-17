/**
 * Factory test — missing mssql driver scenario (MODULE_NOT_FOUND).
 * Mirrors sqlite/factory-missing-driver.test.ts technique:
 * vi.mock('mssql') with a hoisted factory that throws MODULE_NOT_FOUND,
 * so createMssqlSchemaAdapter sees the import fail.
 *
 * Design §"Missing mssql driver names install command", ADR-006 (lazy import).
 * TDD: RED → GREEN. US-027, US-033.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Mock mssql to simulate MODULE_NOT_FOUND ──────────────────────────────
vi.mock('mssql', () => {
  const err = new Error("Cannot find module 'mssql'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  throw err;
});

import { createMssqlSchemaAdapter } from '../../../../src/adapters/engines/mssql/factory.js';
import { ConnectionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Missing mssql driver — names the install command
// ─────────────────────────────────────────────────────────────────────────────

const SQL_CONFIG = {
  server: 'localhost',
  database: 'testdb',
  authentication: { type: 'sql' as const, user: 'sa', password: 'Pass1234' },
};

describe("createMssqlSchemaAdapter() — missing driver 'mssql'", () => {
  it('throws ConnectionError (E_CONNECTION) when mssql is not installed', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });

  it('ConnectionError message names the exact install command "npm i mssql"', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.message.includes('npm i mssql'),
    );
  });

  it('ConnectionError message mentions the package name "mssql"', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.message.includes('mssql'),
    );
  });
});
