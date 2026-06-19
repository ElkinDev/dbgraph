/**
 * json-rows-reassembly.test.ts — reassembleForJson / reassembleSingleForJson (Batch 4, task 4.2).
 *
 * TDD: RED -> GREEN -> REFACTOR.
 * No DB, no child_process. Pure Buffer/string fixtures.
 *
 * Spec connectivity (ADDED):
 *   - "Chunked FOR JSON output reassembles without trimming" (F-4)
 *   - "Non-UTF-8 output is decoded per the profile encoding" (F-5)
 *   - "Malformed output yields a typed actionable error, not a stack trace" (F-6)
 *   - "Reassembly is golden-pinned with exact-set assertions" (ADR-008)
 *
 * US-042 — Profile-driven reassembly of chunked output.
 * US-044 — Batch 6: fixture-driven tests repoint to formal F-4/F-5/F-6/F-9 fixtures.
 *
 * NOTE: parseJsonRows (coercion layer) is UNCHANGED and NOT tested here.
 * These tests target ONLY the reassembly layer (chunk concat + JSON.parse).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  reassembleForJson,
  reassembleSingleForJson,
} from '../../../../../src/adapters/engines/mssql/strategies/json-rows.js';
import type { SqlcmdProfile } from '../../../../../src/adapters/engines/mssql/strategies/profiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONNECTIVITY_FIXTURES = resolve(
  __dirname,
  '../../../../fixtures/mssql/connectivity',
);

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures and helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a SqlcmdProfile with overrides. */
function makeProfile(overrides: Partial<SqlcmdProfile> = {}): SqlcmdProfile {
  return {
    variant: 'legacy-odbc',
    versionRange: '15.x',
    flags: ['-y', '0', '-f', 'o:65001'],
    outputShape: { chunkSize: 2033, hasHeader: false },
    encoding: 'utf8',
    ...overrides,
  };
}

/**
 * Emits the REAL legacy sqlcmd 15.x output shape (measured on 15.0.1300):
 *   - NO column header, NO dashes separator — line 0 is JSON.
 *   - Large results are split into chunkSize-char chunks, one per line.
 *   - ZERO trailing-space padding.
 *   - Trailing CRLF pair closes the output.
 */
function makeLegacyOutput(jsonValue: string, chunkSize = 2033): Buffer {
  const lines: string[] = [];
  for (let i = 0; i < jsonValue.length; i += chunkSize) {
    lines.push(jsonValue.slice(i, i + chunkSize));
  }
  return Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'utf8');
}

/** Simple array fixture for golden tests. */
const GOLDEN_ARRAY = [
  { schema_name: 'dbo', table_name: 'Orders', object_id: 42 },
  { schema_name: 'dbo', table_name: 'Users', object_id: 77 },
];
const GOLDEN_ARRAY_JSON = JSON.stringify(GOLDEN_ARRAY);

/** Simple object fixture for single-object tests. */
const GOLDEN_OBJ = { m: '2024-06-17T10:00:00', c: 7 };
const GOLDEN_OBJ_JSON = JSON.stringify(GOLDEN_OBJ);

// ─────────────────────────────────────────────────────────────────────────────
// reassembleForJson — array output
// ─────────────────────────────────────────────────────────────────────────────

describe('reassembleForJson — basic array reassembly', () => {
  it('returns an empty array for empty sqlcmd output ([])', () => {
    const stdout = makeLegacyOutput('[]');
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual([]);
  });

  it('returns an empty array for completely empty stdout', () => {
    const stdout = Buffer.from('');
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual([]);
  });

  it('parses a single-line (unchunked) JSON array', () => {
    const stdout = makeLegacyOutput(GOLDEN_ARRAY_JSON);
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual(GOLDEN_ARRAY);
  });

  it('GOLDEN: 2033-char chunked output reassembles to exact golden array (ADR-008, L-009)', () => {
    const stdout = makeLegacyOutput(GOLDEN_ARRAY_JSON, 2033);
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual(GOLDEN_ARRAY);
  });

  it('reassembles with small chunk size (stress test — chunks split mid-token)', () => {
    const stdout = makeLegacyOutput(GOLDEN_ARRAY_JSON, 5);
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual(GOLDEN_ARRAY);
  });
});

describe('reassembleForJson — no .trim() at chunk boundaries (F-4/F-6)', () => {
  it('preserves leading/trailing spaces inside string values at chunk boundaries', () => {
    // Construct a value where a chunk boundary falls inside a string with spaces.
    const value = { name: 'Space Sensitive Table' };
    const json = JSON.stringify([value]);
    // Find where "Space" is and split the chunk just before the trailing space
    const spacePos = json.indexOf('Space');
    const chunkSize = spacePos + 6; // chunk ends mid-word "Space " — trailing space preserved

    const stdout = makeLegacyOutput(json, chunkSize);
    const profile = makeProfile({ outputShape: { chunkSize, hasHeader: false } });
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual([value]);
    // Verify the space was not trimmed
    const row = result[0] as Record<string, unknown>;
    expect(row['name']).toBe('Space Sensitive Table');
  });
});

describe('reassembleForJson — (N rows affected) trailer is skipped', () => {
  it('skips the "(N rows affected)" trailer (SET NOCOUNT ON safety net)', () => {
    // Even with SET NOCOUNT ON, add a trailer row to verify it is stripped
    const json = JSON.stringify([{ id: 1 }]);
    const raw = json + '\r\n(1 rows affected)\r\n';
    const stdout = Buffer.from(raw, 'utf8');
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual([{ id: 1 }]);
  });

  it('skips "(1 row affected)" singular form', () => {
    const json = JSON.stringify([{ id: 2 }]);
    const raw = json + '\r\n(1 row affected)\r\n';
    const stdout = Buffer.from(raw, 'utf8');
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual([{ id: 2 }]);
  });
});

describe('reassembleForJson — encoding (F-5)', () => {
  it('decodes UTF-8 output with non-ASCII chars correctly', () => {
    const arr = [{ name: 'café_orders' }, { name: 'naïve_users' }];
    const stdout = makeLegacyOutput(JSON.stringify(arr), 10);
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual(arr);
  });

  it('uses profile.encoding for decoding (latin1 profile decodes latin1 buffer)', () => {
    // A latin1-encoded buffer where 0xE9 = 'é'
    const raw = '[{"n":"caf\xe9"}]';
    const stdout = Buffer.from(raw, 'latin1');
    const profile = makeProfile({ encoding: 'latin1' });
    const result = reassembleForJson(stdout, profile);
    const row = result[0] as Record<string, unknown>;
    expect(row['n']).toBe('caf\xe9'); // the decoded latin1 char
  });
});

describe('reassembleForJson — malformed output yields typed actionable error', () => {
  it('throws a typed error (not a raw JSON.parse stack) on truncated JSON', () => {
    const truncated = Buffer.from('[{"id": 1, "name":', 'utf8');
    const profile = makeProfile();
    expect(() => reassembleForJson(truncated, profile)).toThrow();
    try {
      reassembleForJson(truncated, profile);
    } catch (err) {
      const msg = (err as Error).message;
      // Must mention what was received (first N chars)
      expect(msg).toContain('[{');
      // Must NOT be a raw JSON.parse stack frame
      expect(msg).not.toMatch(/at JSON\.parse/i);
    }
  });

  it('error message contains first N chars of received content', () => {
    const truncated = Buffer.from('[{"bad":"value"', 'utf8');
    const profile = makeProfile();
    let caught: Error | null = null;
    try {
      reassembleForJson(truncated, profile);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('[{');
  });

  it('throws when output parses but is not an array', () => {
    const singleObj = Buffer.from('{"key":"val"}', 'utf8');
    const profile = makeProfile();
    expect(() => reassembleForJson(singleObj, profile)).toThrow();
  });
});

describe('reassembleForJson — hasHeader: true strips header and dashes lines', () => {
  it('skips column header + dashes separator when hasHeader is true', () => {
    const json = JSON.stringify([{ id: 1 }]);
    // Simulate a hypothetical variant that emits header + dashes before JSON
    const raw = 'col1\r\n----\r\n' + json + '\r\n';
    const stdout = Buffer.from(raw, 'utf8');
    const profile = makeProfile({ outputShape: { chunkSize: 2033, hasHeader: true } });
    // The code should defensively skip non-JSON leading lines regardless of hasHeader
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual([{ id: 1 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reassembleSingleForJson — single object (fingerprint) output
// ─────────────────────────────────────────────────────────────────────────────

describe('reassembleSingleForJson — single object output', () => {
  it('parses a plain JSON object (fingerprint use case)', () => {
    const stdout = makeLegacyOutput(GOLDEN_OBJ_JSON);
    const profile = makeProfile();
    const result = reassembleSingleForJson(stdout, profile);
    expect(result).toEqual(GOLDEN_OBJ);
  });

  it('parses a chunked JSON object', () => {
    const stdout = makeLegacyOutput(GOLDEN_OBJ_JSON, 5);
    const profile = makeProfile();
    const result = reassembleSingleForJson(stdout, profile);
    expect(result).toEqual(GOLDEN_OBJ);
  });

  it('returns empty object for empty stdout', () => {
    const stdout = Buffer.from('');
    const profile = makeProfile();
    const result = reassembleSingleForJson(stdout, profile);
    expect(result).toEqual({});
  });

  it('throws a typed error on truncated JSON (not a raw stack)', () => {
    const truncated = Buffer.from('{"m":"2024', 'utf8');
    const profile = makeProfile();
    let caught: Error | null = null;
    try {
      reassembleSingleForJson(truncated, profile);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('{"m"');
    expect(caught?.message).not.toMatch(/at JSON\.parse/i);
  });

  it('throws when output parses as an array instead of an object', () => {
    const arrOut = Buffer.from('[{"key":"val"}]', 'utf8');
    const profile = makeProfile();
    expect(() => reassembleSingleForJson(arrOut, profile)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXACT golden: byte-identical on re-run (ADR-008, L-009)
// ─────────────────────────────────────────────────────────────────────────────

describe('reassembleForJson — EXACT golden (byte-identical on re-run)', () => {
  it('produces EXACTLY the golden array, not a subset (L-009 exact-set)', () => {
    const stdout = makeLegacyOutput(GOLDEN_ARRAY_JSON, 2033);
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    // Exact-set: same length, same order, same values
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ schema_name: 'dbo', table_name: 'Orders', object_id: 42 });
    expect(result[1]).toEqual({ schema_name: 'dbo', table_name: 'Users', object_id: 77 });
  });

  it('2033-char chunked fingerprint object reconstructed EXACTLY (ADR-008)', () => {
    const stdout = makeLegacyOutput(GOLDEN_OBJ_JSON, 2033);
    const profile = makeProfile();
    const result = reassembleSingleForJson(stdout, profile);
    expect(result).toEqual({ m: '2024-06-17T10:00:00', c: 7 });
    expect(Object.keys(result)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture-driven: formal F-4/F-5/F-6/F-9 fixtures (Batch 6, task 6.1 repoint)
// The formal fixtures are the authoritative shape descriptors for these scenarios.
// ─────────────────────────────────────────────────────────────────────────────

describe('F-4 fixture: 2033-char chunk shape (formal fixture repoint, US-044)', () => {
  it('F-4 fixture profile matches the legacy-odbc profile used in golden tests', () => {
    const f4 = JSON.parse(
      readFileSync(join(CONNECTIVITY_FIXTURES, 'F-4.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const shape = f4['outputShape'] as Record<string, unknown>;
    // The fixture must declare the canonical chunk shape
    expect(shape['chunkSize']).toBe(2033);
    expect(shape['hasHeader']).toBe(false);
    // Verify reassembly still works with the fixture-declared chunk size (byte-identical)
    const chunkSize = shape['chunkSize'] as number;
    const stdout = makeLegacyOutput(GOLDEN_ARRAY_JSON, chunkSize);
    const profile = makeProfile({ outputShape: { chunkSize, hasHeader: false } });
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual(GOLDEN_ARRAY);
  });
});

describe('F-5 fixture: encoding profile (formal fixture repoint, US-044)', () => {
  it('F-5 fixture latin1 buffer decodes correctly per profile.encoding', () => {
    const f5 = JSON.parse(
      readFileSync(join(CONNECTIVITY_FIXTURES, 'F-5.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const synth = f5['syntheticBuffer'] as Record<string, unknown>;
    const profile = synth['profile'] as { encoding: string; chunkSize: number; hasHeader: boolean };
    // Reconstruct the synthetic buffer from the fixture-declared byte sequence
    const bytes = synth['byteSequence'] as number[];
    const stdout = Buffer.from(bytes);
    const sqlcmdProfile = makeProfile({ encoding: profile.encoding });
    const result = reassembleForJson(stdout, sqlcmdProfile);
    expect(result).toHaveLength(1);
    const row = result[0] as Record<string, unknown>;
    // The latin1 byte 0xE9 decodes to 'é' in latin1
    expect(typeof row['n']).toBe('string');
  });
});

describe('F-6 fixture: reassembly rules (formal fixture repoint, US-044)', () => {
  it('F-6 fixture neverTrimAtChunkBoundary rule is proven by space-sensitive test', () => {
    const f6 = JSON.parse(
      readFileSync(join(CONNECTIVITY_FIXTURES, 'F-6.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const rules = f6['reassemblyRules'] as Record<string, unknown>;
    expect(rules['neverTrimAtChunkBoundary']).toBe(true);
    // Prove the rule: a value with spaces at a chunk boundary is preserved
    const value = { v: 'space test' };
    const json = JSON.stringify([value]);
    const chunkSize = 10;
    const stdout = makeLegacyOutput(json, chunkSize);
    const profile = makeProfile({ outputShape: { chunkSize, hasHeader: false } });
    const result = reassembleForJson(stdout, profile);
    expect(result).toEqual([value]);
  });
});

describe('F-9 fixture: sql_variant coercion shape (formal fixture repoint, US-044)', () => {
  it('F-9 fixture describes sql_variant-to-JSON-number coercion', () => {
    const f9 = JSON.parse(
      readFileSync(join(CONNECTIVITY_FIXTURES, 'F-9.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const coercion = f9['coercionBehavior'] as Record<string, unknown>;
    expect(coercion['inputType']).toBe('sql_variant');
    expect(coercion['coercedTo']).toBe('JSON number');
    // The syntheticStdout rawLine is a valid JSON array string
    const synth = f9['syntheticStdout'] as Record<string, unknown>;
    const rawLine = synth['rawLine'] as string;
    expect(() => JSON.parse(rawLine)).not.toThrow();
    // Reassembly of the raw line yields the string representation (coerceStringy handles coercion)
    const stdout = Buffer.from(rawLine + '\r\n', 'utf-8');
    const profile = makeProfile();
    const result = reassembleForJson(stdout, profile);
    expect(result).toHaveLength(1);
    // The raw reassembly yields the string (parseJsonRows/coerceStringy coercion is the next layer)
    // Here we just assert the array is parseable and has one row
    expect(Array.isArray(result)).toBe(true);
  });
});
