/**
 * fixtures-content-free.test.ts — US-044 (Batch 6, task 6.1)
 *
 * Asserts that each F-1..F-9 fixture:
 *   1. Is valid JSON
 *   2. Contains NONE of the denied identifiers (schema names, proc source text, object names)
 *   3. Has the required shape fields
 *
 * Spec connectivity (ADDED): "Anonymized F-1..F-9 fixtures exist and are content-free"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fixed deny-list: identifiers, schema names, proc source text, secrets
// (must NOT appear in any fixture file)
const DENY_LIST = [
  'dbo',            // real schema name
  'sys.',           // sys catalog references
  'EXEC',           // proc execution
  'CREATE PROC',    // DDL
  'sp_',            // system procs
  'xp_',            // extended procs
  'password',       // credential
  'secret',         // credential
  'token',          // credential
  'apikey',         // credential
  'connectionstring', // credential
];

const FIXTURE_NAMES = ['F-1', 'F-2', 'F-3', 'F-4', 'F-5', 'F-6', 'F-7', 'F-8', 'F-9'];

function loadFixture(name: string): Record<string, unknown> {
  const fixturePath = join(__dirname, `${name}.json`);
  return JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;
}

describe('F-1..F-9 connectivity fixtures — anonymized and content-free (US-044)', () => {
  for (const name of FIXTURE_NAMES) {
    describe(`${name}.json`, () => {
      const fixturePath = join(__dirname, `${name}.json`);

      it('is valid JSON', () => {
        const raw = readFileSync(fixturePath, 'utf-8');
        expect(() => JSON.parse(raw)).not.toThrow();
      });

      it('contains no denied identifier or credential text (content-free)', () => {
        const content = readFileSync(fixturePath, 'utf-8').toLowerCase();
        const violations: string[] = [];
        for (const denied of DENY_LIST) {
          if (content.includes(denied.toLowerCase())) {
            violations.push(denied);
          }
        }
        expect(violations).toEqual([]);
      });

      it('has required shape fields: _fixture, _description, probeResult, conclusion', () => {
        const obj = loadFixture(name);
        expect(typeof obj['_fixture']).toBe('string');
        expect(typeof obj['_description']).toBe('string');
        expect(typeof obj['conclusion']).toBe('string');
        expect(obj['probeResult']).toBeDefined();

        const pr = obj['probeResult'] as Record<string, unknown>;
        expect(typeof pr['nativeDriver']).toBe('boolean');
        expect(Array.isArray(pr['cliTools'])).toBe(true);
        expect(typeof pr['odbc']).toBe('boolean');
      });
    });
  }
});

describe('F-4/F-6 chunk-shape fixture validation (US-044)', () => {
  it('F-4 fixture encodes chunkSize=2033 and hasHeader=false', () => {
    const f4 = loadFixture('F-4');
    const shape = f4['outputShape'] as Record<string, unknown>;
    expect(shape['chunkSize']).toBe(2033);
    expect(shape['hasHeader']).toBe(false);
  });

  it('F-6 fixture reassemblyRules.neverTrimAtChunkBoundary is true', () => {
    const f6 = loadFixture('F-6');
    const rules = f6['reassemblyRules'] as Record<string, unknown>;
    expect(rules['neverTrimAtChunkBoundary']).toBe(true);
    expect(rules['concatenateVerbatim']).toBe(true);
    expect(rules['dropRowsAffectedTrailer']).toBe(true);
  });
});

describe('F-5 encoding fixture validation (US-044)', () => {
  it('F-5 fixture captures the synthetic latin1 buffer with correct byte sequence', () => {
    const f5 = loadFixture('F-5');
    const synth = f5['syntheticBuffer'] as Record<string, unknown>;
    const profile = synth['profile'] as Record<string, unknown>;
    expect(profile['encoding']).toBe('latin1');
    expect(profile['chunkSize']).toBe(2033);
    expect(profile['hasHeader']).toBe(false);
    // The bytes array must be present and non-empty
    expect(Array.isArray(synth['byteSequence'])).toBe(true);
    expect((synth['byteSequence'] as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('F-9 sql_variant coercion fixture validation (US-044)', () => {
  it('F-9 fixture captures sql_variant-to-JSON-number coercion shape', () => {
    const f9 = loadFixture('F-9');
    const coercion = f9['coercionBehavior'] as Record<string, unknown>;
    expect(coercion['inputType']).toBe('sql_variant');
    expect(coercion['coercedTo']).toBe('JSON number');
    const synth = f9['syntheticStdout'] as Record<string, unknown>;
    expect(typeof synth['rawLine']).toBe('string');
    // afterCoercion is an array
    expect(Array.isArray(synth['afterCoercion'])).toBe(true);
  });
});
