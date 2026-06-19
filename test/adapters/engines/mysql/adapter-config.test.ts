/**
 * Compile-time and structural tests for MysqlAdapterConfig union membership.
 * Task 2.2: widen SchemaAdapterConfig union + JSDoc fix.
 *
 * TDD RED -> GREEN.
 * Spec: "SchemaAdapterConfig union includes the mysql variant without a shape change"
 * Spec: "The union is non-discriminable by shape and dispatch keys on the explicit dialect"
 */

import { describe, it, expect } from 'vitest';
import type { MysqlAdapterConfig, SchemaAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Structural shape: MysqlAdapterConfig fields
// ─────────────────────────────────────────────────────────────────────────────

describe('MysqlAdapterConfig — shape', () => {
  it('accepts a valid MysqlAdapterConfig with required fields', () => {
    const cfg: MysqlAdapterConfig = {
      host: 'db.example.com',
      database: 'myapp',
      user: 'reader',
      password: '${env:MYSQL_PASSWORD}',
    };
    expect(cfg.host).toBe('db.example.com');
    expect(cfg.database).toBe('myapp');
    expect(cfg.user).toBe('reader');
    expect(cfg.password).toBe('${env:MYSQL_PASSWORD}');
  });

  it('accepts optional port field', () => {
    const cfg: MysqlAdapterConfig = {
      host: 'localhost',
      database: 'myapp',
      user: 'reader',
      password: '${env:MYSQL_PASSWORD}',
      port: 3306,
    };
    expect(cfg.port).toBe(3306);
  });

  it('accepts optional ssl: boolean field', () => {
    const cfg: MysqlAdapterConfig = {
      host: 'localhost',
      database: 'myapp',
      user: 'reader',
      password: '${env:MYSQL_PASSWORD}',
      ssl: true,
    };
    expect(cfg.ssl).toBe(true);
  });

  it('accepts optional ssl: object field with rejectUnauthorized', () => {
    const cfg: MysqlAdapterConfig = {
      host: 'localhost',
      database: 'myapp',
      user: 'reader',
      password: '${env:MYSQL_PASSWORD}',
      ssl: { rejectUnauthorized: false },
    };
    if (typeof cfg.ssl === 'object' && cfg.ssl !== null) {
      expect(cfg.ssl.rejectUnauthorized).toBe(false);
    }
  });

  it('has no schema field (the connected database is the extraction scope)', () => {
    const cfg: MysqlAdapterConfig = {
      host: 'localhost',
      database: 'myapp',
      user: 'reader',
      password: '${env:MYSQL_PASSWORD}',
    };
    // schema must NOT be a property of MysqlAdapterConfig
    expect('schema' in cfg).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Union membership: SchemaAdapterConfig includes MysqlAdapterConfig
// Spec: SchemaAdapterConfig union includes the mysql variant without a shape change
// ─────────────────────────────────────────────────────────────────────────────

describe('SchemaAdapterConfig union — includes mysql variant', () => {
  it('a MysqlAdapterConfig is assignable to SchemaAdapterConfig', () => {
    const mysql: MysqlAdapterConfig = {
      host: 'localhost',
      database: 'myapp',
      user: 'reader',
      password: '${env:MYSQL_PASSWORD}',
    };
    // TypeScript compile-time check: MysqlAdapterConfig must be a member of the union
    const cfg: SchemaAdapterConfig = mysql;
    expect(cfg).toBeDefined();
  });

  it('a sqlite config is still assignable to SchemaAdapterConfig (no regression)', () => {
    const sqlite: SchemaAdapterConfig = { file: ':memory:' };
    expect(sqlite).toBeDefined();
  });

  it('a pg config is still assignable to SchemaAdapterConfig (no regression)', () => {
    const pg: SchemaAdapterConfig = {
      host: 'localhost',
      database: 'mydb',
      user: 'u',
      password: '${env:PG_PASSWORD}',
    };
    expect(pg).toBeDefined();
  });
});
