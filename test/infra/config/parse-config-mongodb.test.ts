/**
 * Tests for parseMongodbSource + parseConfig 'mongodb' branch
 * (phase-9b-mongodb, Batch 2, task 2.5).
 * Also covers SUPPORTED_DIALECTS including 'mongodb' (task 2.4).
 * TDD RED -> GREEN.
 *
 * Spec requirements being tested:
 * - "URI must be supplied by env reference, not a literal" — REJECT cleartext URI.
 * - "Connects with a URI reference and default sample size" — uri + database required.
 * - Optional sampleSize and tls accepted; NO host/port/schema/user/password fields.
 * - Unknown dialect still throws UnsupportedDialectError.
 * - SUPPORTED_DIALECTS includes 'mongodb'.
 * - There is no schema/host/port config knob for mongodb.
 */

import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../../src/infra/config/parse-config.js';
import { SUPPORTED_DIALECTS } from '../../../src/infra/config/schema.js';
import { ConfigError, UnsupportedDialectError } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED_DIALECTS includes 'mongodb' (task 2.4)
// Spec: SUPPORTED_DIALECTS includes 'mongodb'
// ─────────────────────────────────────────────────────────────────────────────

describe('SUPPORTED_DIALECTS — includes mongodb', () => {
  it('SUPPORTED_DIALECTS array contains mongodb', () => {
    expect(SUPPORTED_DIALECTS).toContain('mongodb');
  });

  it('SUPPORTED_DIALECTS still contains sqlite, mssql, pg and mysql', () => {
    expect(SUPPORTED_DIALECTS).toContain('sqlite');
    expect(SUPPORTED_DIALECTS).toContain('mssql');
    expect(SUPPORTED_DIALECTS).toContain('pg');
    expect(SUPPORTED_DIALECTS).toContain('mysql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Valid mongodb config — env-ref URI + database
// Spec: "Connects with a URI reference and default sample size"
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — valid mongodb', () => {
  const validMongodb = {
    dialect: 'mongodb',
    source: {
      uri: '${env:MONGODB_URI}',
      database: 'myapp',
    },
  };

  it('parses a minimal valid mongodb config', () => {
    const cfg = parseConfig(validMongodb);
    expect(cfg.dialect).toBe('mongodb');
  });

  it('parsed config retains env ref uri as-is', () => {
    const cfg = parseConfig(validMongodb);
    if (cfg.dialect === 'mongodb') {
      expect(cfg.source.uri).toBe('${env:MONGODB_URI}');
    }
  });

  it('parsed config retains the database as-is', () => {
    const cfg = parseConfig(validMongodb);
    if (cfg.dialect === 'mongodb') {
      expect(cfg.source.database).toBe('myapp');
    }
  });

  it('accepts optional sampleSize field', () => {
    const withSampleSize = { ...validMongodb, source: { ...validMongodb.source, sampleSize: 200 } };
    const cfg = parseConfig(withSampleSize);
    expect(cfg.dialect).toBe('mongodb');
    if (cfg.dialect === 'mongodb') {
      expect(cfg.source.sampleSize).toBe(200);
    }
  });

  it('accepts optional tls field', () => {
    const withTls = { ...validMongodb, source: { ...validMongodb.source, tls: true } };
    const cfg = parseConfig(withTls);
    expect(cfg.dialect).toBe('mongodb');
    if (cfg.dialect === 'mongodb') {
      expect(cfg.source.tls).toBe(true);
    }
  });

  it('accepts optional levels override', () => {
    const withLevels = { ...validMongodb, levels: { collections: 'full' as const } };
    const cfg = parseConfig(withLevels);
    expect(cfg.dialect).toBe('mongodb');
    expect(cfg.levels?.collections).toBe('full');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// URI MUST be an env ref — literal URIs REJECTED
// Spec: "URI must be supplied by env reference, not a literal"
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mongodb: cleartext URI rejected', () => {
  it('throws ConfigError when mongodb uri is a literal string', () => {
    // Use a plaintext literal (no embedded creds) that triggers the env-ref rejection.
    // Any URI that is not a ${env:VAR} reference must be rejected.
    expect(() =>
      parseConfig({
        dialect: 'mongodb',
        source: {
          uri: 'mongodb://localhost:27017',
          database: 'myapp',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('ConfigError message mentions uri and env ref pattern', () => {
    let caught: unknown;
    try {
      parseConfig({
        dialect: 'mongodb',
        source: {
          uri: 'mongodb://plaintext',
          database: 'myapp',
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message.toLowerCase()).toContain('uri');
      expect(caught.message).toContain('${env:');
    }
  });

  it('env-ref uri IS accepted', () => {
    expect(() =>
      parseConfig({
        dialect: 'mongodb',
        source: {
          uri: '${env:MONGODB_URI}',
          database: 'myapp',
        },
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mongodb: missing required fields', () => {
  it('throws ConfigError when mongodb source missing uri', () => {
    expect(() =>
      parseConfig({
        dialect: 'mongodb',
        source: {
          database: 'myapp',
        },
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when mongodb source missing database', () => {
    expect(() =>
      parseConfig({
        dialect: 'mongodb',
        source: {
          uri: '${env:MONGODB_URI}',
        },
      }),
    ).toThrow(ConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// There is no schema/host/port config knob for mongodb
// Spec: "NO schema?/host/port decomposition"
// ─────────────────────────────────────────────────────────────────────────────

describe('parseConfig — mongodb: no schema/host/port fields', () => {
  it('parsed mongodb config has no schema property on source', () => {
    const cfg = parseConfig({
      dialect: 'mongodb',
      source: {
        uri: '${env:MONGODB_URI}',
        database: 'myapp',
      },
    });
    if (cfg.dialect === 'mongodb') {
      expect('schema' in cfg.source).toBe(false);
      expect('host' in cfg.source).toBe(false);
      expect('port' in cfg.source).toBe(false);
      expect('user' in cfg.source).toBe(false);
      expect('password' in cfg.source).toBe(false);
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

  it('mongodb dialect does NOT throw UnsupportedDialectError', () => {
    expect(() =>
      parseConfig({
        dialect: 'mongodb',
        source: {
          uri: '${env:MONGODB_URI}',
          database: 'myapp',
        },
      }),
    ).not.toThrow(UnsupportedDialectError);
  });
});
