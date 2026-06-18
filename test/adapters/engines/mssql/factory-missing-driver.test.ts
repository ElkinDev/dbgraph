/**
 * Factory test — missing mssql driver scenario (MODULE_NOT_FOUND).
 * Mirrors sqlite/factory-missing-driver.test.ts technique:
 * vi.mock('mssql') with a hoisted factory that throws MODULE_NOT_FOUND,
 * so NativeTediousStrategy sees the import fail and re-throws ConnectionError.
 *
 * After the Batch C registry rewrite, createMssqlSchemaAdapter calls
 * NativeTediousStrategy.canConnect() which lazy-imports 'mssql'. The missing-
 * driver error is re-thrown (not swallowed) by NativeTediousStrategy.canConnect()
 * because it's a setup error, not a transient probe failure.
 *
 * The SqlcmdStrategy is stubbed via deps.Sqlcmd to keep the test deterministic.
 *
 * Design §"Missing mssql driver names install command", ADR-006 (lazy import).
 * TDD: GREEN (seam adjustment). US-027, US-033.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ConnectivityStrategy, DetectResult } from '../../../../src/core/ports/connectivity-strategy.js';
import type { MssqlAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';
import type { RawCatalog } from '../../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';

// ─── Mock mssql to simulate MODULE_NOT_FOUND ──────────────────────────────
vi.mock('mssql', () => {
  const err = new Error("Cannot find module 'mssql'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  throw err;
});

import { createMssqlSchemaAdapter } from '../../../../src/adapters/engines/mssql/factory.js';
import { ConnectionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Stub SqlcmdStrategy — never reached in this test (ConnectionError propagates
// from NativeTediousStrategy.canConnect() before sqlcmd is tried)
// ─────────────────────────────────────────────────────────────────────────────

const SqlcmdStub: new (config: MssqlAdapterConfig) => ConnectivityStrategy = class {
  readonly id = 'sqlcmd';
  async detect(): Promise<DetectResult> { return { available: false, detail: 'stubbed' }; }
  async canConnect(): Promise<boolean> { return false; }
  async runCatalog(scope: ExtractionScope): Promise<RawCatalog> {
    void scope;
    throw new Error('SqlcmdStub.runCatalog not implemented');
  }
  async close(): Promise<void> {}
};

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
      createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdStub }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });

  it('ConnectionError message names the exact install command "npm i mssql"', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdStub }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.message.includes('npm i mssql'),
    );
  });

  it('ConnectionError message mentions the package name "mssql"', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdStub }),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.message.includes('mssql'),
    );
  });
});
