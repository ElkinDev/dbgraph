/**
 * Tests for buildConfig + writeConfig — task 1.6 (phase-4-cli-config).
 * Spec: "Plaintext credentials are rejected" + Decision 5 (env-only identity).
 * Scenarios:
 *   - literal host/user/password each throw ConfigError
 *   - ${env:VAR} references are accepted
 *   - writeConfig output is deterministic (fixed key order, newline-terminated)
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { buildConfig, writeConfig } from '../../../src/cli/config/build-config.js';
import { ConfigError } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// buildConfig — sqlite
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConfig — sqlite valid', () => {
  it('builds a sqlite config with a valid env-ref file path', () => {
    const cfg = buildConfig({ dialect: 'sqlite', file: '${env:DBGRAPH_DB_FILE}' });
    expect(cfg.dialect).toBe('sqlite');
    if (cfg.dialect === 'sqlite') {
      expect(cfg.source.file).toBe('${env:DBGRAPH_DB_FILE}');
    }
  });

  it('builds a sqlite config with a literal file path (sqlite files may be literals)', () => {
    const cfg = buildConfig({ dialect: 'sqlite', file: './fixtures/test.db' });
    expect(cfg.dialect).toBe('sqlite');
    if (cfg.dialect === 'sqlite') {
      expect(cfg.source.file).toBe('./fixtures/test.db');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConfig — mssql valid
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConfig — mssql valid', () => {
  const validInputs = {
    dialect: 'mssql' as const,
    server: '${env:DBGRAPH_DB_HOST}',
    database: '${env:DBGRAPH_DB_NAME}',
    user: '${env:DBGRAPH_DB_USER}',
    password: '${env:DBGRAPH_DB_PASSWORD}',
  };

  it('builds a mssql config with all-env-ref identity fields', () => {
    const cfg = buildConfig(validInputs);
    expect(cfg.dialect).toBe('mssql');
  });

  it('source retains the env refs unchanged', () => {
    const cfg = buildConfig(validInputs);
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.server).toBe('${env:DBGRAPH_DB_HOST}');
      expect(cfg.source.password).toBe('${env:DBGRAPH_DB_PASSWORD}');
    }
  });

  it('accepts optional port as env ref', () => {
    const cfg = buildConfig({ ...validInputs, port: '${env:DBGRAPH_DB_PORT}' });
    expect(cfg.dialect).toBe('mssql');
    if (cfg.dialect === 'mssql') {
      expect(cfg.source.port).toBe('${env:DBGRAPH_DB_PORT}');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConfig — plaintext identity fields rejected (ConfigError)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConfig — plaintext identity fields rejected', () => {
  it('throws ConfigError when mssql server is a literal hostname', () => {
    expect(() =>
      buildConfig({
        dialect: 'mssql',
        server: 'myserver.corp.local',
        database: '${env:DBGRAPH_DB_NAME}',
        user: '${env:DBGRAPH_DB_USER}',
        password: '${env:DBGRAPH_DB_PASSWORD}',
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message for literal server mentions "server" and ${env:VAR}', () => {
    let caught: unknown;
    try {
      buildConfig({
        dialect: 'mssql',
        server: 'myserver.corp.local',
        database: '${env:DBGRAPH_DB_NAME}',
        user: '${env:DBGRAPH_DB_USER}',
        password: '${env:DBGRAPH_DB_PASSWORD}',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('server');
      expect(caught.message).toContain('${env:VAR}');
    }
  });

  it('throws ConfigError when mssql user is a literal string', () => {
    expect(() =>
      buildConfig({
        dialect: 'mssql',
        server: '${env:DBGRAPH_DB_HOST}',
        database: '${env:DBGRAPH_DB_NAME}',
        user: 'sa',
        password: '${env:DBGRAPH_DB_PASSWORD}',
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message for literal user mentions "user"', () => {
    let caught: unknown;
    try {
      buildConfig({
        dialect: 'mssql',
        server: '${env:DBGRAPH_DB_HOST}',
        database: '${env:DBGRAPH_DB_NAME}',
        user: 'sa',
        password: '${env:DBGRAPH_DB_PASSWORD}',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('user');
    }
  });

  it('throws ConfigError when mssql password is a literal string', () => {
    expect(() =>
      buildConfig({
        dialect: 'mssql',
        server: '${env:DBGRAPH_DB_HOST}',
        database: '${env:DBGRAPH_DB_NAME}',
        user: '${env:DBGRAPH_DB_USER}',
        password: 's3cr3t_literal',
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message for literal password mentions "password"', () => {
    let caught: unknown;
    try {
      buildConfig({
        dialect: 'mssql',
        server: '${env:DBGRAPH_DB_HOST}',
        database: '${env:DBGRAPH_DB_NAME}',
        user: '${env:DBGRAPH_DB_USER}',
        password: 's3cr3t_literal',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('password');
    }
  });

  it('throws ConfigError when mssql database is a literal string', () => {
    expect(() =>
      buildConfig({
        dialect: 'mssql',
        server: '${env:DBGRAPH_DB_HOST}',
        database: 'caps_production',
        user: '${env:DBGRAPH_DB_USER}',
        password: '${env:DBGRAPH_DB_PASSWORD}',
      }),
    ).toThrow(ConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// writeConfig — deterministic output (fixed key order, newline-terminated)
// ─────────────────────────────────────────────────────────────────────────────

describe('writeConfig — deterministic output', () => {
  const cfg = buildConfig({
    dialect: 'sqlite',
    file: '${env:DBGRAPH_DB_FILE}',
  });

  it('outputs valid JSON', () => {
    const output = writeConfig(cfg);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('output is newline-terminated', () => {
    const output = writeConfig(cfg);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('output is deterministic — same input always produces identical bytes', () => {
    const out1 = writeConfig(cfg);
    const out2 = writeConfig(cfg);
    expect(out1).toBe(out2);
  });

  it('output is 2-space indented (JSON.stringify null, 2)', () => {
    const output = writeConfig(cfg);
    // Check that it contains indented fields
    expect(output).toContain('  "dialect"');
  });

  it('mssql config serializes with fixed key order (dialect before source)', () => {
    const mssqlCfg = buildConfig({
      dialect: 'mssql',
      server: '${env:DBGRAPH_DB_HOST}',
      database: '${env:DBGRAPH_DB_NAME}',
      user: '${env:DBGRAPH_DB_USER}',
      password: '${env:DBGRAPH_DB_PASSWORD}',
    });
    const output = writeConfig(mssqlCfg);
    const dialectPos = output.indexOf('"dialect"');
    const sourcePos = output.indexOf('"source"');
    expect(dialectPos).toBeLessThan(sourcePos);
  });

  it('two calls with the same mssql config produce byte-identical output', () => {
    const mssqlCfg = buildConfig({
      dialect: 'mssql',
      server: '${env:DBGRAPH_DB_HOST}',
      database: '${env:DBGRAPH_DB_NAME}',
      user: '${env:DBGRAPH_DB_USER}',
      password: '${env:DBGRAPH_DB_PASSWORD}',
    });
    const out1 = writeConfig(mssqlCfg);
    const out2 = writeConfig(mssqlCfg);
    expect(out1).toBe(out2);
  });
});
