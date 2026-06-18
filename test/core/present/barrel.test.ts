/**
 * Barrel export verification for new present/ formatters — task 1.9 (phase-5-mcp-server).
 * Spec: Compact format / formatters PURE in present.
 * Design: all new formatters re-exported via src/core/index.ts alongside formatExplore.
 *
 * Verifies that every formatter added in Batch A is accessible from the core barrel.
 */

import { describe, it, expect } from 'vitest';
import * as CoreBarrel from '../../../src/core/index.js';

describe('src/core/index.ts — present/ formatters (Batch A task 1.9)', () => {
  it('exports formatSearch as a function', () => {
    expect(typeof CoreBarrel.formatSearch).toBe('function');
  });

  it('exports formatObject as a function', () => {
    expect(typeof CoreBarrel.formatObject).toBe('function');
  });

  it('exports formatRelated as a function', () => {
    expect(typeof CoreBarrel.formatRelated).toBe('function');
  });

  it('exports formatImpact as a function', () => {
    expect(typeof CoreBarrel.formatImpact).toBe('function');
  });

  it('exports formatPath as a function', () => {
    expect(typeof CoreBarrel.formatPath).toBe('function');
  });

  it('exports formatStatus as a function', () => {
    expect(typeof CoreBarrel.formatStatus).toBe('function');
  });

  it('exports formatPrecheck as a function', () => {
    expect(typeof CoreBarrel.formatPrecheck).toBe('function');
  });

  it('formatExplore is still exported (existing, not broken)', () => {
    expect(typeof CoreBarrel.formatExplore).toBe('function');
  });
});
