/**
 * Tests for resolveSecrets — task 1.5 (phase-4-cli-config).
 * Spec: "Plaintext credentials are rejected, env refs resolved at runtime"
 * Scenarios: env resolves; missing var → ConfigError naming var; injected env map used.
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { resolveSecrets } from '../../../src/infra/config/resolve-secrets.js';
import { ConfigError } from '../../../src/index.js';
import type { DbgraphConfig } from '../../../src/infra/config/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// sqlite — resolves ${env:VAR} from provided env map
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSecrets — sqlite', () => {
  const sqliteCfg: DbgraphConfig = {
    dialect: 'sqlite',
    source: { file: '${env:DBGRAPH_DB_FILE}' },
  };

  it('resolves ${env:VAR} in sqlite source.file from the provided env map', () => {
    const env = { DBGRAPH_DB_FILE: '/path/to/db.sqlite' };
    const resolved = resolveSecrets(sqliteCfg, env);
    if (resolved.dialect === 'sqlite') {
      expect(resolved.source.file).toBe('/path/to/db.sqlite');
    } else {
      expect.fail('Expected sqlite dialect');
    }
  });

  it('leaves literal file paths unchanged (not all sqlite paths are env refs)', () => {
    const literalCfg: DbgraphConfig = {
      dialect: 'sqlite',
      source: { file: './local.db' },
    };
    const resolved = resolveSecrets(literalCfg, {});
    if (resolved.dialect === 'sqlite') {
      expect(resolved.source.file).toBe('./local.db');
    }
  });

  it('throws ConfigError naming the var when DBGRAPH_DB_FILE is unset', () => {
    let caught: unknown;
    try {
      resolveSecrets(sqliteCfg, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('DBGRAPH_DB_FILE');
    }
  });

  it('ConfigError for unset var has code E_CONFIG', () => {
    let caught: unknown;
    try {
      resolveSecrets(sqliteCfg, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.code).toBe('E_CONFIG');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mssql — resolves all identity fields
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSecrets — mssql', () => {
  const mssqlCfg: DbgraphConfig = {
    dialect: 'mssql',
    source: {
      server: '${env:DBGRAPH_DB_HOST}',
      database: '${env:DBGRAPH_DB_NAME}',
      user: '${env:DBGRAPH_DB_USER}',
      password: '${env:DBGRAPH_DB_PASSWORD}',
    },
  };

  const fullEnv = {
    DBGRAPH_DB_HOST: 'myserver.corp.local',
    DBGRAPH_DB_NAME: 'acme_db',
    DBGRAPH_DB_USER: 'svc_dbgraph',
    DBGRAPH_DB_PASSWORD: 's3cr3t',
  };

  it('resolves all identity fields from the provided env map', () => {
    const resolved = resolveSecrets(mssqlCfg, fullEnv);
    if (resolved.dialect === 'mssql') {
      expect(resolved.source.server).toBe('myserver.corp.local');
      expect(resolved.source.database).toBe('acme_db');
      expect(resolved.source.user).toBe('svc_dbgraph');
      expect(resolved.source.password).toBe('s3cr3t');
    } else {
      expect.fail('Expected mssql dialect');
    }
  });

  it('throws ConfigError naming the var when server var is unset', () => {
    let caught: unknown;
    try {
      resolveSecrets(mssqlCfg, {
        DBGRAPH_DB_NAME: 'acme_db',
        DBGRAPH_DB_USER: 'svc',
        DBGRAPH_DB_PASSWORD: 'pw',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('DBGRAPH_DB_HOST');
    }
  });

  it('throws ConfigError naming the var when password var is unset', () => {
    let caught: unknown;
    try {
      resolveSecrets(mssqlCfg, {
        DBGRAPH_DB_HOST: 'server',
        DBGRAPH_DB_NAME: 'db',
        DBGRAPH_DB_USER: 'usr',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('DBGRAPH_DB_PASSWORD');
    }
  });

  it('does NOT resolve to empty string — missing var throws, never empty', () => {
    let threw = false;
    try {
      resolveSecrets(mssqlCfg, {});
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('resolves optional port when present as env ref', () => {
    const withPort: DbgraphConfig = {
      dialect: 'mssql',
      source: {
        ...mssqlCfg.source as {
          server: string; database: string; user: string; password: string;
        },
        port: '${env:DBGRAPH_DB_PORT}',
      },
    };
    const resolved = resolveSecrets(withPort, { ...fullEnv, DBGRAPH_DB_PORT: '1433' });
    if (resolved.dialect === 'mssql') {
      expect(resolved.source.port).toBe('1433');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Env map injection — does NOT read process.env
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSecrets — env map injection', () => {
  it('uses the provided env map, not process.env directly', () => {
    const cfg: DbgraphConfig = {
      dialect: 'sqlite',
      source: { file: '${env:MY_CUSTOM_VAR}' },
    };
    // Provide a custom map that differs from what process.env might have
    const env = { MY_CUSTOM_VAR: '/from/injected/map' };
    const resolved = resolveSecrets(cfg, env);
    if (resolved.dialect === 'sqlite') {
      expect(resolved.source.file).toBe('/from/injected/map');
    }
  });
});
