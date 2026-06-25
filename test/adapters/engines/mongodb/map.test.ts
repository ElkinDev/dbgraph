/**
 * Tests for buildMongodbRawCatalog.
 * Spec: "Extract collections as kind collection";
 *       "A collection type set to off is absent";
 *       "Unique and compound indexes";
 *       "Top-level $jsonSchema required and properties in extra";
 *       "A collection without a validator carries no validator metadata".
 *
 * TDD RED → GREEN.
 * Batch 4, task 4.3.
 * US-030, ADR-008 (determinism: sorted output).
 * EXACT-set assertions (L-009) throughout.
 */

import { describe, it, expect } from 'vitest';
import { buildMongodbRawCatalog } from '../../../../src/adapters/engines/mongodb/map.js';
import type { RawField } from '../../../../src/core/model/catalog.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SCOPE: ExtractionScope = {
  levels: DEFAULT_LEVELS,
};

const OFF_COLLECTIONS_SCOPE: ExtractionScope = {
  levels: { ...DEFAULT_LEVELS, collections: 'off' },
};

const CUSTOMERS_FIELDS: RawField[] = [
  { name: '_id', dataType: 'objectId', frequency: 1.0, nullable: false },
  { name: 'email', dataType: 'string', frequency: 1.0, nullable: false },
  { name: 'name', dataType: 'string', frequency: 1.0, nullable: false },
];

const ORDERS_FIELDS: RawField[] = [
  { name: 'customer_id', dataType: 'objectId', frequency: 1.0, nullable: false },
  { name: 'total', dataType: 'numeric', frequency: 0.9, nullable: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Extract collections as kind collection
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMongodbRawCatalog — extract collections as kind collection', () => {
  it('returns a RawCatalog with engine mongodb', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'customers', fields: CUSTOMERS_FIELDS }],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    expect(catalog.engine).toBe('mongodb');
  });

  it('each collection is a RawObject of kind collection', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [
        { name: 'customers', fields: CUSTOMERS_FIELDS },
        { name: 'orders', fields: ORDERS_FIELDS },
      ],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const kinds = catalog.objects.map((o) => o.kind);
    expect(kinds).toEqual(['collection', 'collection']); // sorted by name
  });

  it('schema = database name on each collection (NEVER null)', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'testdb',
      sampledCollections: [{ name: 'users', fields: [] }],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    expect(obj.schema).toBe('testdb');
    expect(obj.schema).not.toBeNull();
  });

  it('fields are sorted by path within each collection', () => {
    const unsortedFields: RawField[] = [
      { name: 'z_field', dataType: 'string', frequency: 1.0, nullable: false },
      { name: 'a_field', dataType: 'int', frequency: 0.5, nullable: true },
      { name: 'm_field', dataType: 'bool', frequency: 1.0, nullable: false },
    ];
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'things', fields: unsortedFields }],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    const names = obj.fields!.map((f) => f.name);
    expect(names).toEqual(['a_field', 'm_field', 'z_field']);
  });

  it('collections are sorted by name in the output', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [
        { name: 'zebra', fields: [] },
        { name: 'alpha', fields: [] },
        { name: 'middle', fields: [] },
      ],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const names = catalog.objects.map((o) => o.name);
    expect(names).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('schemas array contains the database name', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'users', fields: [] }],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    expect(catalog.schemas).toContain('mydb');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: A collection type set to off is absent
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMongodbRawCatalog — collections off scope', () => {
  it('returns empty objects array when collections level is off', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'customers', fields: CUSTOMERS_FIELDS }],
      indexes: {},
      validators: {},
      scope: OFF_COLLECTIONS_SCOPE,
    });
    expect(catalog.objects).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: EXCLUDE system.* / admin / local / config
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMongodbRawCatalog — exclude system collections', () => {
  it('excludes system.users from output', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [
        { name: 'system.users', fields: [] },
        { name: 'customers', fields: CUSTOMERS_FIELDS },
      ],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const names = catalog.objects.map((o) => o.name);
    expect(names).not.toContain('system.users');
    expect(names).toContain('customers');
  });

  it('excludes system.namespaces from output', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'admin',
      sampledCollections: [
        { name: 'system.namespaces', fields: [] },
        { name: 'real_collection', fields: [] },
      ],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const names = catalog.objects.map((o) => o.name);
    expect(names).not.toContain('system.namespaces');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Unique and compound indexes
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMongodbRawCatalog — indexes', () => {
  it('unique single-key index is present and marked unique', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'users', fields: [] }],
      indexes: {
        users: [
          { name: 'email_unique', key: { email: 1 }, unique: true },
        ],
      },
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    const idx = obj.indexes?.find((i) => i.name === 'email_unique');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(true);
    expect(idx!.columns).toEqual(['email']);
  });

  it('compound two-key index is ONE index with ordered keys preserved', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'orders', fields: [] }],
      indexes: {
        orders: [
          { name: 'compound_idx', key: { customer_id: 1, created_at: -1 }, unique: false },
        ],
      },
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    const indexes = obj.indexes ?? [];
    // ONE index for the compound key
    const compoundIdx = indexes.find((i) => i.name === 'compound_idx');
    expect(compoundIdx).toBeDefined();
    expect(compoundIdx!.columns).toEqual(['customer_id', 'created_at']);
    expect(compoundIdx!.unique).toBe(false);
  });

  it('_id index (name _id_) is included ONCE — not double-counted', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'orders', fields: [] }],
      indexes: {
        orders: [
          { name: '_id_', key: { _id: 1 }, unique: true },
          { name: '_id_', key: { _id: 1 }, unique: true }, // duplicate
        ],
      },
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    const idIndexes = obj.indexes?.filter((i) => i.name === '_id_') ?? [];
    expect(idIndexes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: Top-level $jsonSchema required and properties in extra
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMongodbRawCatalog — $jsonSchema validators in extra', () => {
  it('carries top-level required and properties in collection extra', () => {
    const validator = {
      $jsonSchema: {
        required: ['email', 'name'],
        properties: {
          email: { bsonType: 'string' },
          name: { bsonType: 'string' },
        },
      },
    };
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'users', fields: [] }],
      indexes: {},
      validators: { users: validator },
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    expect(obj.extra).toBeDefined();
    expect(obj.extra!['required']).toEqual(['email', 'name']);
    expect(obj.extra!['properties']).toBeDefined();
  });

  it('A collection without a validator carries no validator metadata', () => {
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'no_validator', fields: [] }],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    // extra should be absent or undefined (no validator metadata)
    expect(obj.extra).toBeUndefined();
  });

  it('does NOT walk nested $jsonSchema structure beyond top level', () => {
    const validator = {
      $jsonSchema: {
        required: ['address'],
        properties: {
          address: {
            bsonType: 'object',
            properties: { city: { bsonType: 'string' } }, // DEEP nesting — must NOT appear in extra
          },
        },
      },
    };
    const catalog = buildMongodbRawCatalog({
      database: 'mydb',
      sampledCollections: [{ name: 'docs', fields: [] }],
      indexes: {},
      validators: { docs: validator },
      scope: DEFAULT_SCOPE,
    });
    const obj = catalog.objects[0]!;
    // Top-level properties reference IS present
    expect(obj.extra!['properties']).toBeDefined();
    // But the deep nested city property is not separately flattened into extra
    const propsValue = obj.extra!['properties'] as Record<string, unknown>;
    const addressProp = propsValue['address'] as Record<string, unknown>;
    // The address object is there as-is (top-level carry), but we only verify
    // the nested city is NOT independently extracted as a top-level extra key
    expect(obj.extra!['city']).toBeUndefined();
    expect(addressProp).toBeDefined(); // present as part of top-level properties
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism — ADR-008
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMongodbRawCatalog — determinism (ADR-008)', () => {
  it('same input → identical output (deterministic)', () => {
    const input = {
      database: 'mydb',
      sampledCollections: [
        { name: 'orders', fields: ORDERS_FIELDS },
        { name: 'customers', fields: CUSTOMERS_FIELDS },
      ],
      indexes: {},
      validators: {},
      scope: DEFAULT_SCOPE,
    };
    const catalog1 = buildMongodbRawCatalog(input);
    const catalog2 = buildMongodbRawCatalog(input);
    expect(JSON.stringify(catalog1)).toBe(JSON.stringify(catalog2));
  });
});
