/**
 * capabilitiesFor('mongodb') + barrel re-exports (Batch 5, task 5.2).
 * STRICT TDD: RED → GREEN
 *
 * Verifies:
 *   - capabilitiesFor('mongodb') returns MONGODB_CAPABILITIES (not undefined, not throws)
 *   - MONGODB_CAPABILITIES is re-exported from the barrel (src/index.ts)
 *   - createMongodbSchemaAdapter is re-exported from the barrel (src/index.ts)
 *   - MongodbCapabilityProbe is re-exported from the barrel (src/index.ts)
 *   - 'redis' (wrong key) still throws UnsupportedDialectError
 *
 * Spec: schema-extraction "Supported dialects, capabilitiesFor and UnsupportedDialectError
 *   recognize mongodb". US-030, ADR-004.
 */

import { describe, it, expect } from 'vitest';
import {
  capabilitiesFor,
  MONGODB_CAPABILITIES,
  createMongodbSchemaAdapter,
  MongodbCapabilityProbe,
  UnsupportedDialectError,
} from '../../src/index.js';

describe('capabilitiesFor — mongodb dialect (task 5.2)', () => {
  it('returns MONGODB_CAPABILITIES for "mongodb"', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix).toBe(MONGODB_CAPABILITIES);
  });

  it('engine is "mongodb"', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.engine).toBe('mongodb');
  });

  it('supported includes collection', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.supported.has('collection')).toBe(true);
  });

  it('supported includes field', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.supported.has('field')).toBe(true);
  });

  it('supported includes index', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.supported.has('index')).toBe(true);
  });

  it('supported does NOT include table', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.supported.has('table')).toBe(false);
  });

  it('supported does NOT include column', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.supported.has('column')).toBe(false);
  });

  it('supportsBodies is false', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.supportsBodies).toBe(false);
  });

  it('supportsDependencyHints is false', () => {
    const matrix = capabilitiesFor('mongodb');
    expect(matrix.supportsDependencyHints).toBe(false);
  });

  it('"redis" (wrong key) still throws UnsupportedDialectError', () => {
    expect(() => capabilitiesFor('redis')).toThrow(UnsupportedDialectError);
  });
});

describe('barrel re-exports — mongodb (task 5.2)', () => {
  it('MONGODB_CAPABILITIES is exported from src/index.ts', () => {
    expect(MONGODB_CAPABILITIES).toBeDefined();
    expect(typeof MONGODB_CAPABILITIES).toBe('object');
  });

  it('createMongodbSchemaAdapter is exported from src/index.ts', () => {
    expect(typeof createMongodbSchemaAdapter).toBe('function');
  });

  it('MongodbCapabilityProbe is exported from src/index.ts', () => {
    expect(typeof MongodbCapabilityProbe).toBe('function');
  });
});
