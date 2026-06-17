/**
 * Public API barrel test — task 7.1.
 * Verifies that src/core/index.ts and src/index.ts export all required symbols
 * as documented in design §2 "Public API surface".
 * Done-check: npx tsc --noEmit clean + this test green.
 */

import { describe, it, expect } from 'vitest';

// ── src/core/index.ts ────────────────────────────────────────────────────────
import * as CoreBarrel from '../../src/core/index.js';

// ── src/index.ts (package root) ──────────────────────────────────────────────
import * as RootBarrel from '../../src/index.js';

describe('src/core/index.ts — exports', () => {
  describe('model types (runtime constants)', () => {
    it('exports NODE_KINDS', () => {
      expect(CoreBarrel.NODE_KINDS).toBeDefined();
      expect(Array.isArray(CoreBarrel.NODE_KINDS)).toBe(true);
    });

    it('exports EDGE_KINDS', () => {
      expect(CoreBarrel.EDGE_KINDS).toBeDefined();
      expect(Array.isArray(CoreBarrel.EDGE_KINDS)).toBe(true);
    });

    it('exports EDGE_CONFIDENCE_VALUES', () => {
      expect(CoreBarrel.EDGE_CONFIDENCE_VALUES).toBeDefined();
      expect(Array.isArray(CoreBarrel.EDGE_CONFIDENCE_VALUES)).toBe(true);
    });

    it('exports INDEX_LEVELS', () => {
      expect(CoreBarrel.INDEX_LEVELS).toBeDefined();
      expect(Array.isArray(CoreBarrel.INDEX_LEVELS)).toBe(true);
    });
  });

  describe('functions', () => {
    it('exports normalizeCatalog', () => {
      expect(typeof CoreBarrel.normalizeCatalog).toBe('function');
    });

    it('exports getNeighbors', () => {
      expect(typeof CoreBarrel.getNeighbors).toBe('function');
    });

    it('exports getImpact', () => {
      expect(typeof CoreBarrel.getImpact).toBe('function');
    });

    it('exports findJoinPath', () => {
      expect(typeof CoreBarrel.findJoinPath).toBe('function');
    });

    it('exports search', () => {
      expect(typeof CoreBarrel.search).toBe('function');
    });
  });

  describe('error classes', () => {
    it('exports DbgraphError', () => {
      expect(typeof CoreBarrel.DbgraphError).toBe('function');
    });

    it('exports NormalizationError', () => {
      expect(typeof CoreBarrel.NormalizationError).toBe('function');
    });

    it('exports StorageError', () => {
      expect(typeof CoreBarrel.StorageError).toBe('function');
    });

    it('exports SchemaVersionError', () => {
      expect(typeof CoreBarrel.SchemaVersionError).toBe('function');
    });

    it('exports QueryError', () => {
      expect(typeof CoreBarrel.QueryError).toBe('function');
    });

    it('exports NotFoundError', () => {
      expect(typeof CoreBarrel.NotFoundError).toBe('function');
    });

    it('exports ConfigError (task 1.2 — phase-4-cli-config)', () => {
      expect(typeof CoreBarrel.ConfigError).toBe('function');
    });

    it('exports UnsupportedDialectError (task 1.2 — phase-4-cli-config)', () => {
      expect(typeof CoreBarrel.UnsupportedDialectError).toBe('function');
    });
  });

  describe('constants', () => {
    it('exports LEVENSHTEIN_THRESHOLD', () => {
      expect(typeof CoreBarrel.LEVENSHTEIN_THRESHOLD).toBe('number');
    });

    it('exports TYPO_CAP', () => {
      expect(typeof CoreBarrel.TYPO_CAP).toBe('number');
    });
  });
});

describe('src/index.ts — package root exports', () => {
  it('exports DBGRAPH_VERSION', () => {
    expect(typeof RootBarrel.DBGRAPH_VERSION).toBe('string');
  });

  it('exports normalizeCatalog (re-exported from core)', () => {
    expect(typeof RootBarrel.normalizeCatalog).toBe('function');
  });

  it('exports getNeighbors (re-exported from core)', () => {
    expect(typeof RootBarrel.getNeighbors).toBe('function');
  });

  it('exports getImpact (re-exported from core)', () => {
    expect(typeof RootBarrel.getImpact).toBe('function');
  });

  it('exports findJoinPath (re-exported from core)', () => {
    expect(typeof RootBarrel.findJoinPath).toBe('function');
  });

  it('exports search (re-exported from core)', () => {
    expect(typeof RootBarrel.search).toBe('function');
  });

  it('exports createSqliteGraphStore (adapter factory — wired at root, not in core)', () => {
    expect(typeof RootBarrel.createSqliteGraphStore).toBe('function');
  });

  it('core barrel and root barrel share the same normalizeCatalog reference', () => {
    expect(RootBarrel.normalizeCatalog).toBe(CoreBarrel.normalizeCatalog);
  });

  it('exports ConfigError (reachable from root barrel, task 1.2)', () => {
    expect(typeof RootBarrel.ConfigError).toBe('function');
  });

  it('exports UnsupportedDialectError (reachable from root barrel, task 1.2)', () => {
    expect(typeof RootBarrel.UnsupportedDialectError).toBe('function');
  });
});
