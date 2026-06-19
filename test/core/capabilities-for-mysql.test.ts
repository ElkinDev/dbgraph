/**
 * capabilitiesFor('mysql') + barrel re-exports (Batch 5, task 5.2).
 * STRICT TDD: RED → GREEN
 *
 * Verifies:
 *   - capabilitiesFor('mysql') returns MYSQL_CAPABILITIES (not undefined, not throws)
 *   - MYSQL_CAPABILITIES is re-exported from the barrel (src/index.ts)
 *   - createMysqlSchemaAdapter is re-exported from the barrel (src/index.ts)
 *   - 'mariadb' (wrong key) still throws UnsupportedDialectError
 *
 * Spec: schema-extraction "Supported dialects, capabilitiesFor and UnsupportedDialectError
 *   recognize mysql". US-029, ADR-004.
 */

import { describe, it, expect } from 'vitest';
import {
  capabilitiesFor,
  MYSQL_CAPABILITIES,
  createMysqlSchemaAdapter,
  UnsupportedDialectError,
} from '../../src/index.js';

describe('capabilitiesFor — mysql dialect (task 5.2)', () => {
  it('returns MYSQL_CAPABILITIES for "mysql"', () => {
    const matrix = capabilitiesFor('mysql');
    expect(matrix).toBe(MYSQL_CAPABILITIES);
  });

  it('engine is "mysql"', () => {
    const matrix = capabilitiesFor('mysql');
    expect(matrix.engine).toBe('mysql');
  });

  it('supported includes table', () => {
    const matrix = capabilitiesFor('mysql');
    expect(matrix.supported.has('table')).toBe(true);
  });

  it('supported includes trigger', () => {
    const matrix = capabilitiesFor('mysql');
    expect(matrix.supported.has('trigger')).toBe(true);
  });

  it('supportsBodies is true', () => {
    const matrix = capabilitiesFor('mysql');
    expect(matrix.supportsBodies).toBe(true);
  });

  it('supportsDependencyHints is false', () => {
    const matrix = capabilitiesFor('mysql');
    expect(matrix.supportsDependencyHints).toBe(false);
  });

  it('"mariadb" (wrong key) still throws UnsupportedDialectError', () => {
    expect(() => capabilitiesFor('mariadb')).toThrow(UnsupportedDialectError);
  });
});

describe('barrel re-exports — mysql (task 5.2)', () => {
  it('MYSQL_CAPABILITIES is exported from src/index.ts', () => {
    expect(MYSQL_CAPABILITIES).toBeDefined();
    expect(typeof MYSQL_CAPABILITIES).toBe('object');
  });

  it('createMysqlSchemaAdapter is exported from src/index.ts', () => {
    expect(typeof createMysqlSchemaAdapter).toBe('function');
  });
});
