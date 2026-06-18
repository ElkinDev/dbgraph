/**
 * Tests for PgSource shape + SUPPORTED_DIALECTS widening (phase-8a-pg, Batch 2, task 2.4).
 * TDD RED → GREEN.
 * Spec: "SUPPORTED_DIALECTS includes 'pg'" (pg-extraction spec, connectivity requirement).
 */

import { describe, it, expect } from 'vitest';
import { SUPPORTED_DIALECTS } from '../../../src/infra/config/schema.js';
import type { PgSource } from '../../../src/infra/config/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED_DIALECTS includes 'pg'
// ─────────────────────────────────────────────────────────────────────────────

describe('SUPPORTED_DIALECTS — includes pg', () => {
  it("includes 'pg' as a supported dialect", () => {
    expect(SUPPORTED_DIALECTS).toContain('pg');
  });

  it("still includes 'sqlite'", () => {
    expect(SUPPORTED_DIALECTS).toContain('sqlite');
  });

  it("still includes 'mssql'", () => {
    expect(SUPPORTED_DIALECTS).toContain('mssql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PgSource shape — type-level checks
// ─────────────────────────────────────────────────────────────────────────────

describe('PgSource — shape', () => {
  it('accepts a minimal PgSource with required fields', () => {
    const source: PgSource = {
      host: 'localhost',
      database: '${env:PG_DB}',
      user: '${env:PG_USER}',
      password: '${env:PG_PASSWORD}',
    };
    expect(source.host).toBe('localhost');
    expect(source.database).toBe('${env:PG_DB}');
  });

  it('accepts an optional port', () => {
    const source: PgSource = {
      host: 'localhost',
      database: '${env:PG_DB}',
      user: '${env:PG_USER}',
      password: '${env:PG_PASSWORD}',
      port: '5432',
    };
    expect(source.port).toBe('5432');
  });

  it('accepts an optional ssl field', () => {
    const source: PgSource = {
      host: 'localhost',
      database: '${env:PG_DB}',
      user: '${env:PG_USER}',
      password: '${env:PG_PASSWORD}',
      ssl: 'true',
    };
    expect(source.ssl).toBe('true');
  });

  it('accepts an optional schema field', () => {
    const source: PgSource = {
      host: 'localhost',
      database: '${env:PG_DB}',
      user: '${env:PG_USER}',
      password: '${env:PG_PASSWORD}',
      schema: '${env:PG_SCHEMA}',
    };
    expect(source.schema).toBe('${env:PG_SCHEMA}');
  });
});
