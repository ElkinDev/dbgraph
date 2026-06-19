/**
 * Tests for parseMysqlSource + parseConfig 'mysql' branch (phase-8b-mysql, Batch 2, task 2.5).
 * Also covers SUPPORTED_DIALECTS including 'mysql' (task 2.4).
 * TDD RED -> GREEN.
 *
 * Spec requirements being tested:
 * - "Password must be supplied by env reference, not a literal" — REJECT cleartext password.
 * - "Connects with explicit credentials and default port" — port defaults to 3306.
 * - Optional ssl accepted; NO schema field.
 * - Unknown dialect still throws UnsupportedDialectError.
 * - SUPPORTED_DIALECTS includes 'mysql'.
 * - There is no schema config knob for mysql.
 */

import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../../src/infra/config/parse-config.js';
import { SUPPORTED_DIALECTS } from '../../../src/infra/config/schema.js';
import { ConfigError, UnsupportedDialectError } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED_DIALECTS includes 'mysql' (task 2.4)
// Spec: SUPPORTED_DIALECTS includes 'mysql'
// ─────────────────────────────────────────────────────────────────────────────

describe('SUPPORTED_DIALECTS — includes mysql', () => {
  it('SUPPORTED_DIALECTS array contains mysql', () => {
    expect(SUPPORTED_DIALECTS).toContain('mysql');
  });

  it('SUPPORTED_DIALECTS still contains sqlite, mssql and pg', () => {
    expect(SUPPORTED_DIALECTS).toContain('sqlite');
    expect(SUPPORTED_DIALECTS).toContain('mssql');
    expect(SUPPORTED_DIALECTS).toContain('pg');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Valid mysql config — env-ref password
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — valid mysql', () => {
  const validMysql = {
    dialect: 'mysql',
    source: {
      host: 'db.example.com',
      database: 'myapp',
      user: '${env:MYSQL_USER}',
      password: '${env:MYSQL_PASSWORD}',
    },
  };

  it('parses a minimal valid mysql config', () => {
    const cfg = parseConfig(validMysql);
    expect(cfg.dialect).toBe('mysql');
  });

  it('parsed config retains env refs as-is', () => {
    const cfg = parseConfig(validMysql);
    if (cfg.dialect === 'mysql') {
      expect(cfg.source.password).toBe('${env:MYSQL_PASSWORD}');
      expect(cfg.source.user).toBe('${env:MYSQL_USER}');
    }
  });

  it('parsed config retains the host as-is', () => {
    const cfg = parseConfig(validMysql);
    if (cfg.dialect === 'mysql') {
      expect(cfg.source.host).toBe('db.example.com');
    }
  });

  it('parsed config retains database', () => {
    const cfg = parseConfig(validMysql);
    if (cfg.dialect === 'mysql') {
      expect(cfg.source.database).toBe('myapp');
    }
  });

  it('accepts optional port field', () => {
    const withPort = { ...validMysql, source: { ...validMysql.source, port: '3307' } };
    const cfg = parseConfig(withPort);
    expect(cfg.dialect).toBe('mysql');
    if (cfg.dialect === 'mysql') {
      expect(cfg.source.port).toBe('3307');
    }
  });

  it('accepts optional ssl field', () => {
    const withSsl = { ...validMysql, source: { ...validMysql.source, ssl: 'true' } };
    const cfg = parseConfig(withSsl);
    expect(cfg.dialect).toBe('mysql');
    if (cfg.dialect === 'mysql') {
      expect(cfg.source.ssl).toBe('true');
    }
  });

  it('accepts optional levels override', () => {
    const withLevels = { ...validMysql, levels: { tables: 'metadata' as const } };
    const cfg = parseConfig(withLevels);
    expect(cfg.dialect).toBe('mysql');
    expect(cfg.levels?.tables).toBe('metadata');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password MUST be an env ref — literal passwords REJECTED
// Spec: "Password must be supplied by env reference, not a literal"
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mysql: cleartext password rejected', () => {
  it('throws ConfigError when mysql password is a literal string', () => {
    expect(() =>
      parseConfig({
        dialect: 'mysql',
        source: {
          host: 'localhost',
          database: 'myapp',
          user: '${env:MYSQL_USER}',
          password: 's3cr3t_literal',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message mentions password and env ref pattern', () => {
    let caught: unknown;
    try {
      parseConfig({
        dialect: 'mysql',
        source: {
          host: 'localhost',
          database: 'myapp',
          user: '${env:MYSQL_USER}',
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
        dialect: 'mysql',
        source: {
          host: 'localhost',
          database: 'myapp',
          user: '${env:MYSQL_USER}',
          password: '${env:MYSQL_PASSWORD}',
        },
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mysql: missing required fields', () => {
  it('throws ConfigError when mysql source missing host', () => {
    expect(() =>
      parseConfig({
        dialect: 'mysql',
        source: {
          database: 'myapp',
          user: '${env:MYSQL_USER}',
          password: '${env:MYSQL_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when mysql source missing database', () => {
    expect(() =>
      parseConfig({
        dialect: 'mysql',
        source: {
          host: 'localhost',
          user: '${env:MYSQL_USER}',
          password: '${env:MYSQL_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when mysql source missing user', () => {
    expect(() =>
      parseConfig({
        dialect: 'mysql',
        source: {
          host: 'localhost',
          database: 'myapp',
          password: '${env:MYSQL_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when mysql source missing password', () => {
    expect(() =>
      parseConfig({
        dialect: 'mysql',
        source: {
          host: 'localhost',
          database: 'myapp',
          user: '${env:MYSQL_USER}',
        },
      }),
    ).toThrow(ConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// There is no schema config knob for mysql
// Spec: "There is no schema config knob"
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mysql: no schema field', () => {
  it('parsed mysql config has no schema property on source', () => {
    const cfg = parseConfig({
      dialect: 'mysql',
      source: {
        host: 'localhost',
        database: 'myapp',
        user: '${env:MYSQL_USER}',
        password: '${env:MYSQL_PASSWORD}',
      },
    });
    if (cfg.dialect === 'mysql') {
      expect('schema' in cfg.source).toBe(false);
    }
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

  it('mysql dialect does NOT throw UnsupportedDialectError', () => {
    expect(() =>
      parseConfig({
        dialect: 'mysql',
        source: {
          host: 'localhost',
          database: 'myapp',
          user: '${env:MYSQL_USER}',
          password: '${env:MYSQL_PASSWORD}',
        },
      }),
    ).not.toThrow(UnsupportedDialectError);
  });
});
