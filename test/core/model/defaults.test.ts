/**
 * RED tests for W-2: default level resolution directly asserted (US-003).
 * Spec ref: graph-model §"Default level resolution"
 *   "triggers full, procedures and functions to metadata, statistics and sampling to off"
 * ADR-003: structural core (tables/columns/constraints/indexes/views) full.
 *
 * References DEFAULT_LEVELS from src/core/model/capability.ts which does not yet export it.
 * Strict TDD — RED.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_LEVELS } from '../../../src/core/model/capability.js';

describe('DEFAULT_LEVELS — spec-mandated defaults (US-003 / ADR-003)', () => {
  it('triggers resolve to full', () => {
    expect(DEFAULT_LEVELS.triggers).toBe('full');
  });

  it('procedures resolve to metadata', () => {
    expect(DEFAULT_LEVELS.procedures).toBe('metadata');
  });

  it('functions resolve to metadata', () => {
    expect(DEFAULT_LEVELS.functions).toBe('metadata');
  });

  it('statistics resolve to off', () => {
    expect(DEFAULT_LEVELS.statistics).toBe('off');
  });

  it('sampling resolves to off', () => {
    expect(DEFAULT_LEVELS.sampling).toBe('off');
  });

  it('tables resolve to full (structural core always on)', () => {
    expect(DEFAULT_LEVELS.tables).toBe('full');
  });

  it('columns resolve to full (structural core always on)', () => {
    expect(DEFAULT_LEVELS.columns).toBe('full');
  });

  it('constraints resolve to full (structural core always on)', () => {
    expect(DEFAULT_LEVELS.constraints).toBe('full');
  });

  it('indexes resolve to full (structural core always on)', () => {
    expect(DEFAULT_LEVELS.indexes).toBe('full');
  });

  it('views resolve to full (structural core always on)', () => {
    expect(DEFAULT_LEVELS.views).toBe('full');
  });
});
