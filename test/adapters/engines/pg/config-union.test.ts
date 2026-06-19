/**
 * Tests for PgAdapterConfig and the widened SchemaAdapterConfig union.
 * Design: PLAIN STRUCTURAL union — PgAdapterConfig distinguished by `host`
 *   (mssql uses `server`, sqlite uses `file`). NO `dialect` tag added.
 * TDD RED: fails until PgAdapterConfig is added to schema-adapter.ts.
 * US-028 (PostgreSQL adapter), pg-extraction spec.
 */

import { describe, it, expectTypeOf } from 'vitest';
import type {
  PgAdapterConfig,
  SchemaAdapterConfig,
  SqliteAdapterConfig,
  MssqlAdapterConfig,
} from '../../../../src/core/ports/schema-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// PgAdapterConfig shape
// ─────────────────────────────────────────────────────────────────────────────

describe('PgAdapterConfig — required fields', () => {
  it('accepts a minimal pg config at the type level', () => {
    const cfg: PgAdapterConfig = {
      host: 'localhost',
      database: 'mydb',
      user: 'pguser',
      password: '${env:PG_PASSWORD}',
    };
    expectTypeOf(cfg).toMatchTypeOf<PgAdapterConfig>();
  });

  it('accepts a pg config with optional port', () => {
    const cfg: PgAdapterConfig = {
      host: 'db.example.com',
      port: 5432,
      database: 'app',
      user: 'app_user',
      password: '${env:PG_PASSWORD}',
    };
    expectTypeOf(cfg).toMatchTypeOf<PgAdapterConfig>();
  });

  it('port is optional', () => {
    const cfg: PgAdapterConfig = {
      host: 'localhost',
      database: 'app',
      user: 'u',
      password: '${env:PG_PASSWORD}',
    };
    expectTypeOf(cfg).toMatchTypeOf<PgAdapterConfig>();
  });

  it('accepts ssl as boolean', () => {
    const cfg: PgAdapterConfig = {
      host: 'localhost',
      database: 'app',
      user: 'u',
      password: '${env:PG_PASSWORD}',
      ssl: true,
    };
    expectTypeOf(cfg).toMatchTypeOf<PgAdapterConfig>();
  });

  it('accepts ssl as object with rejectUnauthorized', () => {
    const cfg: PgAdapterConfig = {
      host: 'localhost',
      database: 'app',
      user: 'u',
      password: '${env:PG_PASSWORD}',
      ssl: { rejectUnauthorized: false },
    };
    expectTypeOf(cfg).toMatchTypeOf<PgAdapterConfig>();
  });

  it('accepts optional schema field', () => {
    const cfg: PgAdapterConfig = {
      host: 'localhost',
      database: 'app',
      user: 'u',
      password: '${env:PG_PASSWORD}',
      schema: 'app_schema',
    };
    expectTypeOf(cfg).toMatchTypeOf<PgAdapterConfig>();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SchemaAdapterConfig union — widened to include PgAdapterConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('SchemaAdapterConfig union — widened with PgAdapterConfig', () => {
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

  it('PgAdapterConfig is assignable to SchemaAdapterConfig', () => {
    const pg: PgAdapterConfig = {
      host: 'localhost',
      database: 'mydb',
      user: 'pguser',
      password: '${env:PG_PASSWORD}',
    };
    expectTypeOf(pg).toMatchTypeOf<SchemaAdapterConfig>();
  });

  it('SqliteAdapterConfig has NO dialect field (back-compat)', () => {
    type HasDialect = 'dialect' extends keyof SqliteAdapterConfig ? true : false;
    expectTypeOf<HasDialect>().toEqualTypeOf<false>();
  });

  it('PgAdapterConfig has NO dialect field (structural, not discriminated)', () => {
    type HasDialect = 'dialect' extends keyof PgAdapterConfig ? true : false;
    expectTypeOf<HasDialect>().toEqualTypeOf<false>();
  });
});
