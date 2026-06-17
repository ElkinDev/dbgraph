/**
 * Tests for MssqlAdapterConfig and the widened SchemaAdapterConfig union.
 * Design: PLAIN STRUCTURAL union — SqliteAdapterConfig UNCHANGED (no dialect field).
 * TDD RED: fails until MssqlAdapterConfig is added to schema-adapter.ts.
 * US-027 (SQL Server adapter foundation).
 */

import { describe, it, expectTypeOf } from 'vitest';
import type {
  MssqlAdapterConfig,
  SchemaAdapterConfig,
  SqliteAdapterConfig,
} from '../../../../src/core/ports/schema-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// MssqlAdapterConfig shape
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlAdapterConfig — required fields', () => {
  it('accepts a minimal SQL auth config at the type level', () => {
    const cfg: MssqlAdapterConfig = {
      server: 'localhost',
      database: 'mydb',
      authentication: { type: 'sql', user: 'sa', password: 'P@ss' },
    };
    expectTypeOf(cfg).toMatchTypeOf<MssqlAdapterConfig>();
  });

  it('accepts an NTLM auth config at the type level', () => {
    const cfg: MssqlAdapterConfig = {
      server: '10.0.0.1',
      port: 1433,
      database: 'corp',
      authentication: {
        type: 'ntlm',
        domain: 'CORP',
        user: 'svc_dbgraph',
        password: 'secret',
      },
      encrypt: true,
      trustServerCertificate: true,
    };
    expectTypeOf(cfg).toMatchTypeOf<MssqlAdapterConfig>();
  });

  it('port is optional', () => {
    // Compile-time: config without port is valid
    const cfg: MssqlAdapterConfig = {
      server: 'db.example.com',
      database: 'app',
      authentication: { type: 'sql', user: 'u', password: 'p' },
    };
    expectTypeOf(cfg).toMatchTypeOf<MssqlAdapterConfig>();
  });

  it('encrypt is optional', () => {
    const withEncrypt: MssqlAdapterConfig = {
      server: 's',
      database: 'd',
      authentication: { type: 'sql', user: 'u', password: 'p' },
      encrypt: false,
    };
    const withoutEncrypt: MssqlAdapterConfig = {
      server: 's',
      database: 'd',
      authentication: { type: 'sql', user: 'u', password: 'p' },
    };
    expectTypeOf(withEncrypt).toMatchTypeOf<MssqlAdapterConfig>();
    expectTypeOf(withoutEncrypt).toMatchTypeOf<MssqlAdapterConfig>();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SchemaAdapterConfig union — widened to include MssqlAdapterConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('SchemaAdapterConfig union', () => {
  it('SqliteAdapterConfig is assignable to SchemaAdapterConfig', () => {
    const sqlite: SqliteAdapterConfig = { file: '/tmp/test.db' };
    expectTypeOf(sqlite).toMatchTypeOf<SchemaAdapterConfig>();
  });

  it('MssqlAdapterConfig is assignable to SchemaAdapterConfig', () => {
    const mssql: MssqlAdapterConfig = {
      server: 'localhost',
      database: 'mydb',
      authentication: { type: 'sql', user: 'sa', password: 'P@ss' },
    };
    expectTypeOf(mssql).toMatchTypeOf<SchemaAdapterConfig>();
  });

  it('SqliteAdapterConfig has NO dialect field (back-compat)', () => {
    // Compile-time guarantee: adding a dialect to SqliteAdapterConfig would break this
    type HasDialect = 'dialect' extends keyof SqliteAdapterConfig ? true : false;
    expectTypeOf<HasDialect>().toEqualTypeOf<false>();
  });
});
