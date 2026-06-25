/**
 * Tests for sampleCollections (sample-walk logic).
 * Spec: "Fixed dataset yields exact field types and frequencies";
 *       "Nested document keys become dotted field paths";
 *       "Array elements are encoded by element type";
 *       "RawCatalog carries field metadata but no document values".
 *
 * TDD RED → GREEN.
 * Batch 4, task 4.2.
 * US-030 (sampling+DISCARD), dbgraph-security (values-NEVER-persisted).
 * EXACT-set assertions (L-009) throughout.
 */

import { describe, it, expect } from 'vitest';
import { sampleCollections } from '../../../../src/adapters/engines/mongodb/sample-walk.js';

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Fixed dataset yields exact field types and frequencies
// ─────────────────────────────────────────────────────────────────────────────

describe('sampleCollections — exact field types and frequencies', () => {
  it('produces email:string with frequency 1.0 when present in every document', () => {
    const docs = [
      { email: 'a@example.com', age: 30 },
      { email: 'b@example.com', age: 25 },
    ];
    const fields = sampleCollections(docs);
    const emailField = fields.find((f) => f.name === 'email');
    expect(emailField).toBeDefined();
    expect(emailField!.dataType).toBe('string');
    expect(emailField!.frequency).toBe(1.0);
  });

  it('produces age:numeric with frequency 0.5 when present in half the documents', () => {
    const docs = [
      { email: 'a@example.com', age: 30 },
      { email: 'b@example.com' },
    ];
    const fields = sampleCollections(docs);
    const ageField = fields.find((f) => f.name === 'age');
    expect(ageField).toBeDefined();
    expect(ageField!.dataType).toBe('numeric');
    expect(ageField!.frequency).toBe(0.5);
  });

  it('produces correct frequency for a field present in 3 of 4 docs (0.75)', () => {
    const docs = [
      { name: 'Alice', score: 10 },
      { name: 'Bob', score: 20 },
      { name: 'Carol' },
      { name: 'Dan', score: 40 },
    ];
    const fields = sampleCollections(docs);
    const scoreField = fields.find((f) => f.name === 'score');
    expect(scoreField).toBeDefined();
    expect(scoreField!.frequency).toBe(0.75);
  });

  it('returns empty array for empty document list', () => {
    const fields = sampleCollections([]);
    expect(fields).toHaveLength(0);
  });

  it('returns EXACT field set — no phantom or duplicate fields', () => {
    const docs = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
    const fields = sampleCollections(docs);
    const names = fields.map((f) => f.name).sort();
    expect(names).toEqual(['a', 'b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Nested document keys become dotted field paths
// ─────────────────────────────────────────────────────────────────────────────

describe('sampleCollections — dotted paths for nested documents', () => {
  it('emits address.city as a dotted path from a nested subdocument', () => {
    const docs = [
      { address: { city: 'London', zip: 'W1' } },
      { address: { city: 'Paris', zip: '75001' } },
    ];
    const fields = sampleCollections(docs);
    const names = fields.map((f) => f.name).sort();
    expect(names).toEqual(['address.city', 'address.zip']);
  });

  it('emits deeply nested paths: user.profile.bio', () => {
    const docs = [{ user: { profile: { bio: 'hello' } } }];
    const fields = sampleCollections(docs);
    const names = fields.map((f) => f.name).sort();
    expect(names).toEqual(['user.profile.bio']);
  });

  it('does NOT emit the parent object key as a field (only leaf dotted paths)', () => {
    const docs = [{ address: { city: 'London' } }];
    const fields = sampleCollections(docs);
    const hasAddress = fields.some((f) => f.name === 'address');
    expect(hasAddress).toBe(false);
  });

  it('nested path carries correct dataType', () => {
    const docs = [{ a: { b: 'hello' } }, { a: { b: 'world' } }];
    const fields = sampleCollections(docs);
    const bField = fields.find((f) => f.name === 'a.b');
    expect(bField).toBeDefined();
    expect(bField!.dataType).toBe('string');
    expect(bField!.frequency).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Array elements are encoded by element type
// ─────────────────────────────────────────────────────────────────────────────

describe('sampleCollections — array element type encoding', () => {
  it('emits items[].sku path for an array of subdocuments with a sku key', () => {
    const docs = [
      { items: [{ sku: 'A1', qty: 1 }, { sku: 'B2', qty: 2 }] },
    ];
    const fields = sampleCollections(docs);
    const names = fields.map((f) => f.name).sort();
    // Each key of the array element subdocument is emitted as items[].key
    expect(names).toContain('items[].sku');
    expect(names).toContain('items[].qty');
  });

  it('emits tags[] as string[] for an array of strings', () => {
    const docs = [{ tags: ['nodejs', 'typescript'] }];
    const fields = sampleCollections(docs);
    const tagsField = fields.find((f) => f.name === 'tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.dataType).toBe('string[]');
  });

  it('emits scores[] as numeric[] for an array of numbers', () => {
    const docs = [{ scores: [1, 2, 3] }];
    const fields = sampleCollections(docs);
    const scoresField = fields.find((f) => f.name === 'scores');
    expect(scoresField).toBeDefined();
    expect(scoresField!.dataType).toBe('numeric[]');
  });

  it('array field frequency is 1.0 when present in all docs', () => {
    const docs = [
      { tags: ['a', 'b'] },
      { tags: ['c'] },
    ];
    const fields = sampleCollections(docs);
    const tagsField = fields.find((f) => f.name === 'tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.frequency).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Mixed BSON types → sorted union dataType
// ─────────────────────────────────────────────────────────────────────────────

describe('sampleCollections — mixed BSON types → sorted union', () => {
  it('emits int|string for a field that appears as number in one doc and string in another', () => {
    const docs = [
      { code: 42 },
      { code: 'A1' },
    ];
    const fields = sampleCollections(docs);
    const codeField = fields.find((f) => f.name === 'code');
    expect(codeField).toBeDefined();
    // 42 → numeric, 'A1' → string → sorted union → 'numeric|string'
    expect(codeField!.dataType).toBe('numeric|string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: nullable flag
// ─────────────────────────────────────────────────────────────────────────────

describe('sampleCollections — nullable flag', () => {
  it('nullable is true when a field has frequency < 1', () => {
    const docs = [{ a: 1 }, { b: 2 }];
    const fields = sampleCollections(docs);
    const aField = fields.find((f) => f.name === 'a');
    expect(aField).toBeDefined();
    expect(aField!.nullable).toBe(true);
  });

  it('nullable is false when a field is present in all docs', () => {
    const docs = [{ a: 1 }, { a: 2 }];
    const fields = sampleCollections(docs);
    const aField = fields.find((f) => f.name === 'a');
    expect(aField).toBeDefined();
    expect(aField!.nullable).toBe(false);
  });

  it('nullable is true when null appears in the types set', () => {
    const docs = [{ a: null }, { a: 'x' }];
    const fields = sampleCollections(docs);
    const aField = fields.find((f) => f.name === 'a');
    expect(aField).toBeDefined();
    expect(aField!.nullable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY: VALUES-NEVER-PERSISTED (dbgraph-security, US-031)
// Spec: "RawCatalog carries field metadata but no document values"
// Feed fixture docs containing sentinel values — assert NONE escape into output.
// ─────────────────────────────────────────────────────────────────────────────

describe('sampleCollections — VALUES-NEVER-PERSISTED (security invariant)', () => {
  it('no sampled document value appears anywhere in the produced RawField[]', () => {
    const SENTINEL_EMAIL = 'secret@ultra-sensitive.com';
    const SENTINEL_SSN = '123-45-6789';
    const SENTINEL_TOKEN = 'tok_supersecret_abc123';

    const docs = [
      {
        email: SENTINEL_EMAIL,
        ssn: SENTINEL_SSN,
        token: SENTINEL_TOKEN,
        age: 42,
        active: true,
      },
      {
        email: 'another@example.com',
        ssn: '987-65-4321',
        token: 'tok_other_xyz',
        age: 35,
        active: false,
      },
    ];

    const fields = sampleCollections(docs);

    // Serialize the entire output to a string and check no sentinel value appears
    const serialized = JSON.stringify(fields);

    expect(serialized).not.toContain(SENTINEL_EMAIL);
    expect(serialized).not.toContain(SENTINEL_SSN);
    expect(serialized).not.toContain(SENTINEL_TOKEN);
    expect(serialized).not.toContain('42'); // age value — only dataType/frequency survive
    // Verify field NAMES are present (the metadata IS there)
    expect(fields.some((f) => f.name === 'email')).toBe(true);
    expect(fields.some((f) => f.name === 'ssn')).toBe(true);
    expect(fields.some((f) => f.name === 'token')).toBe(true);
  });

  it('the output contains ONLY name, dataType, frequency, nullable — no document values', () => {
    const docs = [{ username: 'admin', role: 'superuser', level: 99 }];
    const fields = sampleCollections(docs);

    for (const field of fields) {
      // Only these four keys should be present
      const keys = Object.keys(field).sort();
      // nullable is optional so might not be present on all
      for (const key of keys) {
        expect(['name', 'dataType', 'frequency', 'nullable']).toContain(key);
      }
      // Values should be the METADATA kinds — name is string, dataType is string,
      // frequency is number between 0 and 1
      expect(typeof field.name).toBe('string');
      expect(typeof field.dataType).toBe('string');
      expect(typeof field.frequency).toBe('number');
      expect(field.frequency).toBeGreaterThanOrEqual(0);
      expect(field.frequency).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism — sorted output
// ─────────────────────────────────────────────────────────────────────────────

describe('sampleCollections — deterministic sorted output (ADR-008)', () => {
  it('returns fields sorted by name (alphabetical)', () => {
    const docs = [{ z: 1, a: 2, m: 3 }];
    const fields = sampleCollections(docs);
    const names = fields.map((f) => f.name);
    expect(names).toEqual([...names].sort());
  });

  it('deterministic across multiple calls with same input', () => {
    const docs = [{ b: 1, a: 'x', c: true }];
    const fields1 = sampleCollections(docs);
    const fields2 = sampleCollections(docs);
    expect(fields1.map((f) => f.name)).toEqual(fields2.map((f) => f.name));
  });
});
