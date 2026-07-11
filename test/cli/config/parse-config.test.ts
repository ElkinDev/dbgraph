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
// M1 (L-009): mssql plaintext identity fields REJECTED at parse time
// Spec (cli-config): "parseMssqlSource MUST reject a plaintext
//   server/database/user/password (and port/domain when present)" — mirrors the
//   pg/mysql/mongodb read guard and the mssql WRITE path (build-config.ts:82-87),
//   closing the read/write asymmetry (mssql-config-hardening M1).
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mssql: plaintext identity fields rejected', () => {
  const validMssql = {
    dialect: 'mssql',
    source: {
      server: '${env:DBGRAPH_DB_HOST}',
      database: '${env:DBGRAPH_DB_NAME}',
      user: '${env:DBGRAPH_DB_USER}',
      password: '${env:DBGRAPH_DB_PASSWORD}',
    },
  };

  it('throws ConfigError when mssql server is a literal string', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          server: 'localhost',
          database: '${env:DBGRAPH_DB_NAME}',
          user: '${env:DBGRAPH_DB_USER}',
          password: '${env:DBGRAPH_DB_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when mssql database is a literal string', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          server: '${env:DBGRAPH_DB_HOST}',
          database: 'catalog_db',
          user: '${env:DBGRAPH_DB_USER}',
          password: '${env:DBGRAPH_DB_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when mssql user is a literal string', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          server: '${env:DBGRAPH_DB_HOST}',
          database: '${env:DBGRAPH_DB_NAME}',
          user: 'sa',
          password: '${env:DBGRAPH_DB_PASSWORD}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when mssql password is a literal string', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          server: '${env:DBGRAPH_DB_HOST}',
          database: '${env:DBGRAPH_DB_NAME}',
          user: '${env:DBGRAPH_DB_USER}',
          password: 's3cr3t_literal',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message names the offending field and mentions ${env:VAR}', () => {
    let caught: unknown;
    try {
      parseConfig({
        dialect: 'mssql',
        source: {
          server: '${env:DBGRAPH_DB_HOST}',
          database: '${env:DBGRAPH_DB_NAME}',
          user: '${env:DBGRAPH_DB_USER}',
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

  it('all-env-ref mssql config IS accepted (regression guard)', () => {
    expect(() => parseConfig(validMssql)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A1.5: integrated auth mode — no credentials required
// connectivity-strategies Batch A
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mssql integrated auth (A1.5)', () => {
  const integratedCfg = {
    dialect: 'mssql',
    source: {
      server: '${env:DBGRAPH_DB_HOST}',
      database: '${env:DBGRAPH_DB_NAME}',
      auth: 'integrated',
    },
  };

  it('parses an integrated config with only server and database', () => {
    const cfg = parseConfig(integratedCfg);
    expect(cfg.dialect).toBe('mssql');
  });

  it('parsed integrated source carries server and database', () => {
    const cfg = parseConfig(integratedCfg);
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.server).toBe('${env:DBGRAPH_DB_HOST}');
      expect(cfg.source.database).toBe('${env:DBGRAPH_DB_NAME}');
    }
  });

  it('parsed integrated source has auth = "integrated"', () => {
    const cfg = parseConfig(integratedCfg);
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.auth).toBe('integrated');
    }
  });

  it('integrated source has no user, password, or domain', () => {
    const cfg = parseConfig(integratedCfg);
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.user).toBeUndefined();
      expect(cfg.source.password).toBeUndefined();
      expect(cfg.source.domain).toBeUndefined();
    }
  });

  it('does NOT throw when user/password absent in integrated mode', () => {
    expect(() => parseConfig(integratedCfg)).not.toThrow();
  });

  it('sql mode still requires user', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          server: '${env:S}',
          database: '${env:D}',
          auth: 'sql',
          // user missing
          password: '${env:P}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('sql mode still requires password', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          server: '${env:S}',
          database: '${env:D}',
          auth: 'sql',
          user: '${env:U}',
          // password missing
        },
      }),
    ).toThrow(ConfigError);
  });

  it('ntlm mode still requires user and password', () => {
    expect(() =>
      parseConfig({
        dialect: 'mssql',
        source: {
          server: '${env:S}',
          database: '${env:D}',
          auth: 'ntlm',
          domain: '${env:DOM}',
          // user missing
          password: '${env:P}',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('default inference: domain present → ntlm (no auth field)', () => {
    const cfg = parseConfig({
      dialect: 'mssql',
      source: {
        server: '${env:S}',
        database: '${env:D}',
        user: '${env:U}',
        domain: '${env:DOM}',
        password: '${env:P}',
      },
    });
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.auth).toBe('ntlm');
    }
  });

  it('default inference: no domain → sql (no auth field)', () => {
    const cfg = parseConfig({
      dialect: 'mssql',
      source: {
        server: '${env:S}',
        database: '${env:D}',
        user: '${env:U}',
        password: '${env:P}',
      },
    });
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.auth).toBe('sql');
    }
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
