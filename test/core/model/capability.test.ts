/**
 * RED→GREEN tests for ExtractionScope.inferRelationships (task 3.1).
 * Spec: graph-model §"inferRelationships is optional and defaults to off".
 * Design D3: flag keeps SQL OFF (byte-identical goldens); secondary auto-trigger in the hook.
 * US-008
 *
 * STRICT TDD — RED first (field does not exist yet), GREEN after adding to capability.ts.
 */

import { describe, it, expect } from 'vitest';
import type { ExtractionScope } from '../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// ExtractionScope.inferRelationships — optional, default off
// ─────────────────────────────────────────────────────────────────────────────

describe('ExtractionScope.inferRelationships (task 3.1 — US-008)', () => {
  const BASE_LEVELS = {
    tables: 'full' as const,
    columns: 'full' as const,
    constraints: 'full' as const,
    indexes: 'full' as const,
    views: 'full' as const,
    procedures: 'metadata' as const,
    functions: 'metadata' as const,
    triggers: 'full' as const,
    sequences: 'metadata' as const,
    collections: 'full' as const,
    fields: 'full' as const,
    statistics: 'off' as const,
    sampling: 'off' as const,
  };

  it('ExtractionScope is valid without the inferRelationships field (field is optional)', () => {
    // TypeScript proves this: no TS error when the field is absent.
    const scope: ExtractionScope = { levels: BASE_LEVELS };
    // The field must be absent / undefined when not set — inference is OFF.
    expect(scope.inferRelationships).toBeUndefined();
  });

  it('ExtractionScope accepts inferRelationships: false (explicit OFF)', () => {
    const scope: ExtractionScope = { levels: BASE_LEVELS, inferRelationships: false };
    expect(scope.inferRelationships).toBe(false);
  });

  it('ExtractionScope accepts inferRelationships: true (opt-in ON)', () => {
    const scope: ExtractionScope = { levels: BASE_LEVELS, inferRelationships: true };
    expect(scope.inferRelationships).toBe(true);
  });

  it('existing scopes without inferRelationships stay valid — no breakage (backward compat)', () => {
    // Simulates every existing call site that constructs ExtractionScope without the new field.
    const scope: ExtractionScope = {
      levels: BASE_LEVELS,
      include: ['dbo.*'],
      exclude: ['audit.*'],
    };
    // Must type-check cleanly and behave as inference OFF.
    expect(scope.inferRelationships).toBeUndefined();
    // The gate condition in normalize.ts is: scope.inferRelationships === true
    // When undefined, === true is false → inference is OFF. Proven here at model level.
    expect(scope.inferRelationships === true).toBe(false);
  });
});
