/**
 * RED tests for W-1: off-level absence reason recording (US-003).
 * Spec refs:
 *   graph-model §"off level is an absence, not silence":
 *     "a queryable absence reason is representable"
 *   graph-normalization §"off omits the node but records the reason":
 *     "a queryable absence reason 'indexes not indexed by configuration' is recorded for affected tables"
 *
 * NormalizationResult MUST expose `omitted: readonly { kind: NodeKind; reason: string }[]`
 * populated by normalizeCatalog when any object type resolves to off in the scope.
 *
 * Strict TDD — RED: these tests reference `result.omitted` which does not exist yet.
 */

import { describe, it, expect } from 'vitest';
import { normalizeCatalog } from '../../../src/core/normalize/normalize.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';
import type { NodeKind } from '../../../src/core/model/node.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawCatalog } from '../../../src/core/model/catalog.js';

const FIXTURE_DIR = join(import.meta.dirname, '../../fixtures');

function loadFixture(name: string): RawCatalog {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as RawCatalog;
}

// Scope that puts indexes at off (so index nodes are omitted)
const INDEXES_OFF_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'off',    // <<< off → must record omission
    views: 'full',
    procedures: 'full',
    functions: 'full',
    triggers: 'full',
    sequences: 'metadata',
    collections: 'metadata',
    fields: 'metadata',
    statistics: 'off',
    sampling: 'off',
  },
};

// Scope that puts procedures at off
const PROCEDURES_OFF_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'off',  // <<< off → must record omission
    functions: 'off',   // <<< off → must record omission
    triggers: 'full',
    sequences: 'metadata',
    collections: 'metadata',
    fields: 'metadata',
    statistics: 'off',
    sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// W-1a: result.omitted is present on NormalizationResult
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCatalog — W-1 off-level absence recording', () => {
  it('result has an omitted field (queryable channel exists)', () => {
    const raw = loadFixture('catalog-levels');
    const result = normalizeCatalog(raw, INDEXES_OFF_SCOPE);
    // The omitted field must be present (even if empty for this scope)
    expect(result).toHaveProperty('omitted');
    expect(Array.isArray(result.omitted)).toBe(true);
  });

  it('omitted contains an entry for the off-level index kind', () => {
    const raw = loadFixture('catalog-levels');
    const result = normalizeCatalog(raw, INDEXES_OFF_SCOPE);
    // indexes level is 'off' in INDEXES_OFF_SCOPE → NodeKind 'index' must appear
    const kinds = result.omitted.map((o) => o.kind);
    expect(kinds).toContain('index' as NodeKind);
  });

  it('each omitted entry has kind and reason string', () => {
    const raw = loadFixture('catalog-levels');
    const result = normalizeCatalog(raw, INDEXES_OFF_SCOPE);
    for (const entry of result.omitted) {
      expect(typeof entry.kind).toBe('string');
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('reason text describes configuration omission (spec wording)', () => {
    const raw = loadFixture('catalog-levels');
    const result = normalizeCatalog(raw, INDEXES_OFF_SCOPE);
    // NodeKind for scope.levels.indexes is 'index'
    const indexEntry = result.omitted.find((o) => o.kind === 'index');
    expect(indexEntry).toBeDefined();
    // Spec says "not indexed by configuration"
    expect(indexEntry!.reason).toMatch(/not indexed by configuration/i);
  });

  it('omitted contains entries for each off kind in scope (procedures + functions)', () => {
    const raw = loadFixture('catalog-levels');
    const result = normalizeCatalog(raw, PROCEDURES_OFF_SCOPE);
    const kinds = result.omitted.map((o) => o.kind);
    expect(kinds).toContain('procedure' as NodeKind);
    expect(kinds).toContain('function' as NodeKind);
  });

  it('omitted does NOT include kinds that are not off', () => {
    const raw = loadFixture('catalog-levels');
    const result = normalizeCatalog(raw, INDEXES_OFF_SCOPE);
    const kinds = result.omitted.map((o) => o.kind);
    // tables is 'full' — must NOT appear in omitted
    expect(kinds).not.toContain('table' as NodeKind);
    // triggers is 'full' — must NOT appear in omitted
    expect(kinds).not.toContain('trigger' as NodeKind);
  });

  it('omitted is deterministic across runs (ADR-008)', () => {
    const raw = loadFixture('catalog-levels');
    const r1 = normalizeCatalog(raw, INDEXES_OFF_SCOPE);
    const r2 = normalizeCatalog(raw, INDEXES_OFF_SCOPE);
    expect(JSON.stringify(r1.omitted)).toBe(JSON.stringify(r2.omitted));
  });
});
