/**
 * Integration test: fingerprint() DDL/DML stability (US-009).
 * Design §fingerprint "ALTER→value changes; INSERT→unchanged".
 *
 * Gate: DBGRAPH_INTEGRATION=1.
 * Per-suite hookTimeout: 240 000 ms (container cold start).
 *
 * US-009 (fingerprint changes on DDL / stable on DML).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startMssqlContainer,
  mssqlIntegrationEnabled,
} from '../../../fixtures/mssql/container.js';
import type { MssqlContainerHandle } from '../../../fixtures/mssql/container.js';
import { createMssqlSchemaAdapter } from '../../../../src/adapters/engines/mssql/factory.js';

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// Duck-typed mssql module shape (avoids importing mssql at module level — ADR-006)
type MssqlPool = {
  request(): { query(sql: string): Promise<unknown> };
  close(): Promise<void>;
};
type MssqlMod = {
  ConnectionPool: new (cfg: unknown) => { connect(): Promise<MssqlPool> };
};

async function openWritePool(handle: MssqlContainerHandle): Promise<MssqlPool> {
  const mssqlMod = await import('mssql' as string) as unknown as MssqlMod;
  const poolCfg = {
    server: handle.config.server,
    port: handle.config.port,
    database: 'master',
    user: (handle.config.authentication as { user: string }).user,
    password: (handle.config.authentication as { password: string }).password,
    options: {
      encrypt: handle.config.encrypt ?? true,
      trustServerCertificate: handle.config.trustServerCertificate ?? true,
    },
  };
  return new mssqlMod.ConnectionPool(poolCfg).connect();
}

let handle: MssqlContainerHandle;

describe.skipIf(!mssqlIntegrationEnabled())(
  'MSSQL fingerprint integration — DDL/DML stability (US-009)',
  () => {
    beforeAll(async () => {
      handle = await startMssqlContainer();
    }, 240_000);

    afterAll(async () => {
      if (handle !== undefined) await handle.stop();
    }, 60_000);

    it('fingerprint is a 64-character hex string', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const fp = await adapter.fingerprint();
      await adapter.close();

      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    it('fingerprint is stable across DML-only changes (INSERT does not change schema)', async () => {
      // Capture baseline fingerprint
      const adapterA = await createMssqlSchemaAdapter(handle.config);
      const fpBefore = await adapterA.fingerprint();
      await adapterA.close();

      // DML-only: insert a row into regions (no DDL)
      const writePool = await openWritePool(handle);
      try {
        await writePool
          .request()
          .query(`INSERT INTO dbo.regions (region_id, region_name) VALUES (9001, 'Integration Test Region')`);
      } finally {
        await writePool.close();
      }

      // Fingerprint must remain the same after DML
      const adapterB = await createMssqlSchemaAdapter(handle.config);
      const fpAfter = await adapterB.fingerprint();
      await adapterB.close();

      expect(fpAfter).toBe(fpBefore);
    });

    it('fingerprint changes after a DDL operation (CREATE TABLE adds a new object)', async () => {
      // Capture baseline fingerprint
      const adapterA = await createMssqlSchemaAdapter(handle.config);
      const fpBefore = await adapterA.fingerprint();
      await adapterA.close();

      // DDL: CREATE a new table — increments COUNT(*) in sys.objects
      // Using CREATE TABLE is more reliable than ALTER TABLE for fingerprint tests
      // because it adds a new row to sys.objects (COUNT changes deterministically).
      const ddlPool = await openWritePool(handle);
      try {
        await ddlPool
          .request()
          .query(`CREATE TABLE dbo.fp_ddl_sentinel (id int NOT NULL, CONSTRAINT PK_fp_ddl_sentinel PRIMARY KEY (id))`);
      } finally {
        await ddlPool.close();
      }

      // Fingerprint must differ after DDL (COUNT changed + modify_date changed)
      const adapterB = await createMssqlSchemaAdapter(handle.config);
      const fpAfter = await adapterB.fingerprint();
      await adapterB.close();

      expect(fpAfter).not.toBe(fpBefore);
    });
  },
);

if (!mssqlIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
