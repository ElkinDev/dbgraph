/**
 * capabilitiesFor('pg') + barrel re-exports (Batch 5, task 5.3).
 * STRICT TDD: RED → GREEN
 *
 * Verifies:
 *   - capabilitiesFor('pg') returns PG_CAPABILITIES (not undefined, not throws)
 *   - PG_CAPABILITIES is re-exported from the barrel (src/index.ts)
 *   - createPgSchemaAdapter is re-exported from the barrel (src/index.ts)
 *   - 'postgres' (wrong key) still throws UnsupportedDialectError
 *
 * Spec: schema-extraction "Supported dialects, capabilitiesFor and UnsupportedDialectError
 *   recognize pg". US-028, ADR-004.
 */

import { describe, it, expect } from 'vitest';
import {
  capabilitiesFor,
  PG_CAPABILITIES,
  createPgSchemaAdapter,
  UnsupportedDialectError,
} from '../../src/index.js';

describe('capabilitiesFor — pg dialect (task 5.3)', () => {
  it('returns PG_CAPABILITIES for "pg"', () => {
    const matrix = capabilitiesFor('pg');
    expect(matrix).toBe(PG_CAPABILITIES);
  });

  it('engine is "pg"', () => {
    const matrix = capabilitiesFor('pg');
    expect(matrix.engine).toBe('pg');
  });

  it('supported includes table', () => {
    const matrix = capabilitiesFor('pg');
    expect(matrix.supported.has('table')).toBe(true);
  });

  it('supportsBodies is true', () => {
    const matrix = capabilitiesFor('pg');
    expect(matrix.supportsBodies).toBe(true);
  });

  it('supportsDependencyHints is false', () => {
    const matrix = capabilitiesFor('pg');
    expect(matrix.supportsDependencyHints).toBe(false);
  });

  it('"postgres" (wrong key) still throws UnsupportedDialectError', () => {
    expect(() => capabilitiesFor('postgres')).toThrow(UnsupportedDialectError);
  });
});

describe('barrel re-exports — pg (task 5.3)', () => {
  it('PG_CAPABILITIES is exported from src/index.ts', () => {
    expect(PG_CAPABILITIES).toBeDefined();
    expect(typeof PG_CAPABILITIES).toBe('object');
  });

  it('createPgSchemaAdapter is exported from src/index.ts', () => {
    expect(typeof createPgSchemaAdapter).toBe('function');
  });
});
