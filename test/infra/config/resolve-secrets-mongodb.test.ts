/**
 * Tests for resolveMongodbSource + resolveSecrets 'mongodb' branch
 * (phase-9b-mongodb, Batch 2, task 2.6).
 * TDD RED -> GREEN.
 *
 * Spec requirements being tested:
 * - "the URI ${env:VAR} is resolved env-only" — URI must be resolved from env map.
 * - Missing env var → ConfigError naming the variable.
 * - Optional fields (sampleSize, tls) pass through unchanged.
 * - database passes through unchanged (not an env ref itself).
 */

import { describe, it, expect } from 'vitest';
import { resolveSecrets } from '../../../src/infra/config/resolve-secrets.js';
import { ConfigError } from '../../../src/index.js';
import type { DbgraphConfig } from '../../../src/infra/config/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// resolveSecrets — mongodb: resolves URI from env map
// Spec: "the URI ${env:VAR} is resolved env-only"
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSecrets — mongodb', () => {
  const mongodbCfg: DbgraphConfig = {
    dialect: 'mongodb',
    source: {
      uri: '${env:MONGODB_URI}',
      database: 'myapp',
    },
  };

  const fullEnv = {
    MONGODB_URI: 'mongodb://localhost:27017',
  };

  it('resolves the URI from the provided env map', () => {
    const resolved = resolveSecrets(mongodbCfg, fullEnv);
    if (resolved.dialect === 'mongodb') {
      expect(resolved.source.uri).toBe('mongodb://localhost:27017');
    } else {
      expect.fail('Expected mongodb dialect');
    }
  });

  it('leaves database unchanged (it is not an env ref)', () => {
    const resolved = resolveSecrets(mongodbCfg, fullEnv);
    if (resolved.dialect === 'mongodb') {
      expect(resolved.source.database).toBe('myapp');
    } else {
      expect.fail('Expected mongodb dialect');
    }
  });

  it('throws ConfigError naming the var when MONGODB_URI is unset', () => {
    let caught: unknown;
    try {
      resolveSecrets(mongodbCfg, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('MONGODB_URI');
    }
  });

  it('ConfigError for unset URI var has code E_CONFIG', () => {
    let caught: unknown;
    try {
      resolveSecrets(mongodbCfg, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.code).toBe('E_CONFIG');
    }
  });

  it('does NOT resolve to empty string — missing var throws, never empty', () => {
    let threw = false;
    try {
      resolveSecrets(mongodbCfg, {});
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('passes through optional sampleSize unchanged', () => {
    const withSampleSize: DbgraphConfig = {
      dialect: 'mongodb',
      source: {
        uri: '${env:MONGODB_URI}',
        database: 'myapp',
        sampleSize: 250,
      },
    };
    const resolved = resolveSecrets(withSampleSize, fullEnv);
    if (resolved.dialect === 'mongodb') {
      expect(resolved.source.sampleSize).toBe(250);
    }
  });

  it('passes through optional tls unchanged', () => {
    const withTls: DbgraphConfig = {
      dialect: 'mongodb',
      source: {
        uri: '${env:MONGODB_URI}',
        database: 'myapp',
        tls: true,
      },
    };
    const resolved = resolveSecrets(withTls, fullEnv);
    if (resolved.dialect === 'mongodb') {
      expect(resolved.source.tls).toBe(true);
    }
  });

  it('preserves levels when present', () => {
    const withLevels: DbgraphConfig = {
      dialect: 'mongodb',
      source: {
        uri: '${env:MONGODB_URI}',
        database: 'myapp',
      },
      levels: { collections: 'full' },
    };
    const resolved = resolveSecrets(withLevels, fullEnv);
    expect(resolved.levels?.collections).toBe('full');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Env map injection — does NOT read process.env
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSecrets — mongodb env map injection', () => {
  it('uses the provided env map, not process.env directly', () => {
    const cfg: DbgraphConfig = {
      dialect: 'mongodb',
      source: {
        uri: '${env:MY_MONGO_URI}',
        database: 'testdb',
      },
    };
    const env = { MY_MONGO_URI: 'mongodb://injected:27017' };
    const resolved = resolveSecrets(cfg, env);
    if (resolved.dialect === 'mongodb') {
      expect(resolved.source.uri).toBe('mongodb://injected:27017');
    }
  });
});
