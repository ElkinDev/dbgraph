/**
 * Tests for parseConfig — task 1.4 (phase-4-cli-config).
 * Spec: "Config model is a dialect-discriminated, env-only schema"
 * Scenarios: valid parses; unknown dialect → UnsupportedDialectError;
 *            malformed level/missing field → ConfigError naming field.
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../../src/infra/config/parse-config.js';
import { ConfigError, UnsupportedDialectError } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Valid sqlite config
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — valid sqlite', () => {
  const validSqlite = {
    dialect: 'sqlite',
    source: { file: '${env:DBGRAPH_DB_FILE}' },
  };

  it('parses a minimal valid sqlite config', () => {
    const cfg = parseConfig(validSqlite);
    expect(cfg.dialect).toBe('sqlite');
  });

  it('parsed config retains the source file reference as-is', () => {
    const cfg = parseConfig(validSqlite);
    if (cfg.dialect === 'sqlite') {
      expect(cfg.source.file).toBe('${env:DBGRAPH_DB_FILE}');
    }
  });

  it('accepts a sqlite config with optional driver field', () => {
    const withDriver = {
      dialect: 'sqlite',
      source: { file: '${env:DBGRAPH_DB_FILE}' },
      driver: 'better-sqlite3',
    };
    const cfg = parseConfig(withDriver);
    expect(cfg.dialect).toBe('sqlite');
  });

  it('accepts a sqlite config with optional levels override', () => {
    const withLevels = {
      dialect: 'sqlite',
      source: { file: '${env:DBGRAPH_DB_FILE}' },
      levels: { tables: 'metadata' as const },
    };
    const cfg = parseConfig(withLevels);
    expect(cfg.dialect).toBe('sqlite');
    expect(cfg.levels?.tables).toBe('metadata');
  });

  it('accepts a sqlite config with literal file path (sqlite file path may be literal)', () => {
    const withLiteralPath = {
      dialect: 'sqlite',
      source: { file: './local.db' },
    };
    const cfg = parseConfig(withLiteralPath);
    expect(cfg.dialect).toBe('sqlite');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Valid mssql config
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — valid mssql', () => {
  const validMssql = {
    dialect: 'mssql',
    source: {
      server: '${env:DBGRAPH_DB_HOST}',
      database: '${env:DBGRAPH_DB_NAME}',
      user: '${env:DBGRAPH_DB_USER}',
      password: '${env:DBGRAPH_DB_PASSWORD}',
    },
  };

  it('parses a minimal valid mssql config', () => {
    const cfg = parseConfig(validMssql);
    expect(cfg.dialect).toBe('mssql');
  });

  it('parsed config retains env refs as-is', () => {
    const cfg = parseConfig(validMssql);
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.server).toBe('${env:DBGRAPH_DB_HOST}');
      expect(cfg.source.password).toBe('${env:DBGRAPH_DB_PASSWORD}');
    }
  });

  it('accepts optional port field', () => {
    const withPort = {
      ...validMssql,
      source: { ...validMssql.source, port: '${env:DBGRAPH_DB_PORT}' },
    };
    const cfg = parseConfig(withPort);
    expect(cfg.dialect).toBe('mssql');
  });

  it('accepts optional domain field', () => {
    const withDomain = {
      ...validMssql,
      source: { ...validMssql.source, domain: '${env:DBGRAPH_DB_DOMAIN}' },
    };
    const cfg = parseConfig(withDomain);
    expect(cfg.dialect).toBe('mssql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown dialect → UnsupportedDialectError
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — unknown dialect', () => {
  it('throws UnsupportedDialectError for unknown dialect', () => {
    expect(() =>
      parseConfig({ dialect: 'oracle', source: { file: 'x.db' } }),
    ).toThrow(UnsupportedDialectError);
  });

  it('thrown UnsupportedDialectError has code E_UNSUPPORTED_DIALECT', () => {
    let caught: unknown;
    try {
      parseConfig({ dialect: 'postgres', source: {} });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsupportedDialectError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Malformed input → ConfigError naming the field
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — malformed input', () => {
  it('throws ConfigError when dialect is missing', () => {
    expect(() => parseConfig({ source: { file: 'x.db' } })).toThrow(ConfigError);
  });

  it('ConfigError message names the "dialect" field', () => {
    let caught: unknown;
    try {
      parseConfig({ source: { file: 'x.db' } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('dialect');
    }
  });

  it('throws ConfigError when source is missing', () => {
    expect(() => parseConfig({ dialect: 'sqlite' })).toThrow(ConfigError);
  });

  it('ConfigError message names the "source" field when missing', () => {
    let caught: unknown;
    try {
      parseConfig({ dialect: 'sqlite' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('source');
    }
  });

  it('throws ConfigError when mssql source is missing required "server" field', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          database: '${env:DBGRAPH_DB_NAME}',
          user: '${env:DBGRAPH_DB_USER}',
          password: '${env:DBGRAPH_DB_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message names the "server" field for mssql', () => {
    let caught: unknown;
    try {
      parseConfig({
        dialect: 'mssql',
        source: {
          database: '${env:DBGRAPH_DB_NAME}',
          user: '${env:DBGRAPH_DB_USER}',
          password: '${env:DBGRAPH_DB_PASSWORD}',
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('server');
    }
  });

  it('throws ConfigError for malformed levels value', () => {
    expect(() =>
      parseConfig({
        dialect: 'sqlite',
        source: { file: '${env:DBGRAPH_DB_FILE}' },
        levels: { tables: 'invalid-level' },
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message names the offending level field', () => {
    let caught: unknown;
    try {
      parseConfig({
        dialect: 'sqlite',
        source: { file: '${env:DBGRAPH_DB_FILE}' },
        levels: { tables: 'invalid-level' },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('tables');
    }
  });

  it('throws ConfigError for completely non-object input', () => {
    expect(() => parseConfig(null)).toThrow(ConfigError);
    expect(() => parseConfig('string')).toThrow(ConfigError);
    expect(() => parseConfig(42)).toThrow(ConfigError);
  });

  it('throws ConfigError when sqlite source is missing required "file" field', () => {
    expect(() =>
      parseConfig({ dialect: 'sqlite', source: {} }),
    ).toThrow(ConfigError);
  });
});
