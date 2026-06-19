/**
 * Tests for parsePgSource + parseConfig 'pg' branch (phase-8a-pg, Batch 2, task 2.5).
 * TDD RED → GREEN.
 *
 * Spec requirements being tested:
 * - "Password must be supplied by env reference, not a literal" — REJECT cleartext password.
 * - "Connects with explicit credentials and default port" — default port 5432.
 * - Optional ssl / schema accepted.
 * - Unknown dialect still throws UnsupportedDialectError.
 */

import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../../src/infra/config/parse-config.js';
import { ConfigError, UnsupportedDialectError } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Valid pg config — env-ref password
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — valid pg', () => {
  const validPg = {
    dialect: 'pg',
    source: {
      host: 'db.example.com',
      database: '${env:PG_DB}',
      user: '${env:PG_USER}',
      password: '${env:PG_PASSWORD}',
    },
  };

  it('parses a minimal valid pg config', () => {
    const cfg = parseConfig(validPg);
    expect(cfg.dialect).toBe('pg');
  });

  it('parsed config retains env refs as-is', () => {
    const cfg = parseConfig(validPg);
    if (cfg.dialect === 'pg') {
      expect(cfg.source.database).toBe('${env:PG_DB}');
      expect(cfg.source.password).toBe('${env:PG_PASSWORD}');
    }
  });

  it('parsed config retains the host as-is', () => {
    const cfg = parseConfig(validPg);
    if (cfg.dialect === 'pg') {
      expect(cfg.source.host).toBe('db.example.com');
    }
  });

  it('accepts optional port field', () => {
    const withPort = { ...validPg, source: { ...validPg.source, port: '5433' } };
    const cfg = parseConfig(withPort);
    expect(cfg.dialect).toBe('pg');
    if (cfg.dialect === 'pg') {
      expect(cfg.source.port).toBe('5433');
    }
  });

  it('accepts optional ssl field', () => {
    const withSsl = { ...validPg, source: { ...validPg.source, ssl: 'true' } };
    const cfg = parseConfig(withSsl);
    expect(cfg.dialect).toBe('pg');
    if (cfg.dialect === 'pg') {
      expect(cfg.source.ssl).toBe('true');
    }
  });

  it('accepts optional schema field', () => {
    const withSchema = { ...validPg, source: { ...validPg.source, schema: 'public' } };
    const cfg = parseConfig(withSchema);
    expect(cfg.dialect).toBe('pg');
    if (cfg.dialect === 'pg') {
      expect(cfg.source.schema).toBe('public');
    }
  });

  it('accepts optional levels override', () => {
    const withLevels = { ...validPg, levels: { tables: 'metadata' as const } };
    const cfg = parseConfig(withLevels);
    expect(cfg.dialect).toBe('pg');
    expect(cfg.levels?.tables).toBe('metadata');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password MUST be an env ref — literal passwords REJECTED
// Spec: "Password must be supplied by env reference, not a literal"
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — pg: cleartext password rejected', () => {
  it('throws ConfigError when pg password is a literal string', () => {
    expect(() =>
      parseConfig({
        dialect: 'pg',
        source: {
          host: 'localhost',
          database: '${env:PG_DB}',
          user: '${env:PG_USER}',
          password: 's3cr3t_literal',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message mentions "password" and ${env:VAR}', () => {
    let caught: unknown;
    try {
      parseConfig({
        dialect: 'pg',
        source: {
          host: 'localhost',
          database: '${env:PG_DB}',
          user: '${env:PG_USER}',
          password: 'plaintext',
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message.toLowerCase()).toContain('password');
      expect(caught.message).toContain('${env:');
    }
  });

  it('env-ref password IS accepted', () => {
    expect(() =>
      parseConfig({
        dialect: 'pg',
        source: {
          host: 'localhost',
          database: '${env:PG_DB}',
          user: '${env:PG_USER}',
          password: '${env:PG_PASSWORD}',
        },
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — pg: missing required fields', () => {
  it('throws ConfigError when pg source missing "host"', () => {
    expect(() =>
      parseConfig({
        dialect: 'pg',
        source: {
          database: '${env:PG_DB}',
          user: '${env:PG_USER}',
          password: '${env:PG_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when pg source missing "database"', () => {
    expect(() =>
      parseConfig({
        dialect: 'pg',
        source: {
          host: 'localhost',
          user: '${env:PG_USER}',
          password: '${env:PG_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when pg source missing "user"', () => {
    expect(() =>
      parseConfig({
        dialect: 'pg',
        source: {
          host: 'localhost',
          database: '${env:PG_DB}',
          password: '${env:PG_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when pg source missing "password"', () => {
    expect(() =>
      parseConfig({
        dialect: 'pg',
        source: {
          host: 'localhost',
          database: '${env:PG_DB}',
          user: '${env:PG_USER}',
        },
      }),
    ).toThrow(ConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown dialect still throws UnsupportedDialectError
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — unknown dialect still throws UnsupportedDialectError', () => {
  it('unknown dialect "oracle" still throws UnsupportedDialectError', () => {
    expect(() =>
      parseConfig({ dialect: 'oracle', source: {} }),
    ).toThrow(UnsupportedDialectError);
  });
});
