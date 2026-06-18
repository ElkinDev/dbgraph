/**
 * Tests for json-rows.ts — FOR-JSON validation/coercion → MssqlRowInput.
 * Spec mssql-extraction "Malformed sqlcmd output is rejected, not cast".
 *
 * Covers:
 *   - bit 0/1 → boolean coercion for the 8 bit fields
 *   - numeric-string → number coercion for the id/ordinal fields
 *   - absent nullable text → null
 *   - malformed / missing-required → throw
 *
 * connectivity-strategies Batch B, task B2.2.
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { parseJsonRows } from '../../../../../src/adapters/engines/mssql/strategies/json-rows.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: minimal valid raw JSON rows from sqlcmd FOR JSON output
// ─────────────────────────────────────────────────────────────────────────────

function makeTableRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    table_name: 'Users',
    object_id: 42,
    ...overrides,
  };
}

function makeColumnRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    table_name: 'Users',
    column_id: 1,
    column_name: 'id',
    data_type: 'int',
    max_length: 4,
    precision: 10,
    scale: 0,
    is_nullable: 0,
    is_computed: 0,
    computed_definition: null,
    default_definition: null,
    ...overrides,
  };
}

function makeIndexRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    table_name: 'Users',
    index_name: 'PK_Users',
    is_unique: 1,
    is_primary_key: 1,
    is_unique_constraint: 0,
    type_desc: 'CLUSTERED',
    filter_definition: null,
    column_name: 'id',
    key_ordinal: 1,
    index_column_id: 1,
    is_included_column: 0,
    ...overrides,
  };
}

function makeTriggerEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trigger_id: 101,
    trigger_name: 'trg_Users_insert',
    parent_object_id: 42,
    is_instead_of_trigger: 0,
    event_type: 'INSERT',
    ...overrides,
  };
}

function makeSequenceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    sequence_name: 'seq_OrderId',
    data_type: 'bigint',
    start_value: '1',
    increment: '1',
    minimum_value: '1',
    maximum_value: '9223372036854775807',
    is_cycling: 0,
    ...overrides,
  };
}

function makeKeyConstraintRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    table_name: 'Users',
    constraint_name: 'PK_Users',
    constraint_type: 'PK',
    column_name: 'id',
    key_ordinal: 1,
    ...overrides,
  };
}

function makeFkRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    table_name: 'Orders',
    constraint_name: 'FK_Orders_Users',
    fk_id: 200,
    ref_schema_name: 'dbo',
    ref_table_name: 'Users',
    local_column: 'user_id',
    ref_column: 'id',
    constraint_column_id: 1,
    ...overrides,
  };
}

function makeCheckRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    table_name: 'Users',
    constraint_name: 'CK_Users_age',
    definition: '([age] > 0)',
    ...overrides,
  };
}

function makeModuleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    object_name: 'vw_ActiveUsers',
    object_type: 'V ',
    object_id: 999,
    definition: 'SELECT * FROM Users WHERE active = 1',
    ...overrides,
  };
}

function makeExtendedPropRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    object_name: 'Users',
    column_id: 0,
    column_name: null,
    description: 'User accounts',
    ...overrides,
  };
}

function makeDepRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_name: 'dbo',
    object_name: 'vw_ActiveUsers',
    object_type: 'V ',
    ref_schema_name: 'dbo',
    ref_object_name: 'Users',
    ref_object_id: 42,
    ...overrides,
  };
}

// Minimal valid input with all families
function makeMinimalInput(overrides: Partial<Record<string, unknown[]>> = {}) {
  return {
    tables: [makeTableRow()],
    columns: [makeColumnRow()],
    keyConstraints: [makeKeyConstraintRow()],
    foreignKeys: [makeFkRow()],
    checkConstraints: [makeCheckRow()],
    indexes: [makeIndexRow()],
    modules: [makeModuleRow()],
    triggerEvents: [makeTriggerEventRow()],
    sequences: [makeSequenceRow()],
    extendedProperties: [makeExtendedPropRow()],
    dependencies: [makeDepRow()],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path: valid coercion succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonRows — bit coercion (0/1 → boolean)', () => {
  it('coerces is_nullable: 0 → false on ColumnRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.columns[0]!.is_nullable).toBe(false);
  });

  it('coerces is_nullable: 1 → true on ColumnRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      columns: [makeColumnRow({ is_nullable: 1 })],
    }));
    expect(result.columns[0]!.is_nullable).toBe(true);
  });

  it('coerces is_computed: 0 → false on ColumnRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.columns[0]!.is_computed).toBe(false);
  });

  it('coerces is_unique: 1 → true on IndexRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.indexes[0]!.is_unique).toBe(true);
  });

  it('coerces is_primary_key: 1 → true on IndexRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.indexes[0]!.is_primary_key).toBe(true);
  });

  it('coerces is_unique_constraint: 0 → false on IndexRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.indexes[0]!.is_unique_constraint).toBe(false);
  });

  it('coerces is_included_column: 0 → false on IndexRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.indexes[0]!.is_included_column).toBe(false);
  });

  it('coerces is_instead_of_trigger: 0 → false on TriggerEventRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.triggerEvents[0]!.is_instead_of_trigger).toBe(false);
  });

  it('coerces is_cycling: 0 → false on SequenceRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.sequences[0]!.is_cycling).toBe(false);
  });

  it('coerces is_cycling: 1 → true on SequenceRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      sequences: [makeSequenceRow({ is_cycling: 1 })],
    }));
    expect(result.sequences[0]!.is_cycling).toBe(true);
  });

  it('already-boolean true passes through for is_nullable', () => {
    const result = parseJsonRows(makeMinimalInput({
      columns: [makeColumnRow({ is_nullable: true })],
    }));
    expect(result.columns[0]!.is_nullable).toBe(true);
  });

  it('already-boolean false passes through for is_nullable', () => {
    const result = parseJsonRows(makeMinimalInput({
      columns: [makeColumnRow({ is_nullable: false })],
    }));
    expect(result.columns[0]!.is_nullable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path: numeric-string coercion
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonRows — numeric-string coercion', () => {
  it('coerces object_id string "42" → number on TableRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      tables: [makeTableRow({ object_id: '42' })],
    }));
    expect(result.tables[0]!.object_id).toBe(42);
    expect(typeof result.tables[0]!.object_id).toBe('number');
  });

  it('coerces fk_id string "200" → number on FkRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      foreignKeys: [makeFkRow({ fk_id: '200' })],
    }));
    expect(result.foreignKeys[0]!.fk_id).toBe(200);
    expect(typeof result.foreignKeys[0]!.fk_id).toBe('number');
  });

  it('coerces column_id string "1" → number on ColumnRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      columns: [makeColumnRow({ column_id: '1' })],
    }));
    expect(result.columns[0]!.column_id).toBe(1);
  });

  it('coerces key_ordinal string "1" → number on KeyConstraintRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      keyConstraints: [makeKeyConstraintRow({ key_ordinal: '1' })],
    }));
    expect(result.keyConstraints[0]!.key_ordinal).toBe(1);
  });

  it('coerces constraint_column_id string "1" → number on FkRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      foreignKeys: [makeFkRow({ constraint_column_id: '1' })],
    }));
    expect(result.foreignKeys[0]!.constraint_column_id).toBe(1);
  });

  it('coerces index_column_id string "1" → number on IndexRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      indexes: [makeIndexRow({ index_column_id: '1' })],
    }));
    expect(result.indexes[0]!.index_column_id).toBe(1);
  });

  it('already-number passes through unchanged', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.tables[0]!.object_id).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path: absent nullable text fields → null
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonRows — absent nullable text → null', () => {
  it('absent computed_definition stays null', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.columns[0]!.computed_definition).toBeNull();
  });

  it('absent default_definition stays null', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.columns[0]!.default_definition).toBeNull();
  });

  it('absent filter_definition stays null on IndexRow', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(result.indexes[0]!.filter_definition).toBeNull();
  });

  it('absent definition stays null on ModuleRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      modules: [makeModuleRow({ definition: null })],
    }));
    expect(result.modules[0]!.definition).toBeNull();
  });

  it('absent ref_object_id stays null on DepRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      dependencies: [makeDepRow({ ref_object_id: null })],
    }));
    expect(result.dependencies[0]!.ref_object_id).toBeNull();
  });

  it('absent ref_schema_name stays null on DepRow', () => {
    const result = parseJsonRows(makeMinimalInput({
      dependencies: [makeDepRow({ ref_schema_name: null })],
    }));
    expect(result.dependencies[0]!.ref_schema_name).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rejection: malformed / missing required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonRows — malformed input → throw', () => {
  it('throws when tables family is not an array', () => {
    const input = makeMinimalInput({ tables: 'bad' as unknown as unknown[] });
    expect(() => parseJsonRows(input)).toThrow();
  });

  it('throws when a TableRow is missing schema_name', () => {
    const input = makeMinimalInput({
      tables: [makeTableRow({ schema_name: undefined })],
    });
    expect(() => parseJsonRows(input)).toThrow(/schema_name/i);
  });

  it('throws when a TableRow is missing table_name', () => {
    const input = makeMinimalInput({
      tables: [makeTableRow({ table_name: undefined })],
    });
    expect(() => parseJsonRows(input)).toThrow(/table_name/i);
  });

  it('throws when a TableRow has non-numeric object_id that cannot be coerced', () => {
    const input = makeMinimalInput({
      tables: [makeTableRow({ object_id: 'not-a-number' })],
    });
    expect(() => parseJsonRows(input)).toThrow();
  });

  it('throws when a ColumnRow is missing column_name', () => {
    const input = makeMinimalInput({
      columns: [makeColumnRow({ column_name: undefined })],
    });
    expect(() => parseJsonRows(input)).toThrow(/column_name/i);
  });

  it('throws when a ColumnRow has invalid is_nullable value', () => {
    const input = makeMinimalInput({
      columns: [makeColumnRow({ is_nullable: 'yes' })],
    });
    expect(() => parseJsonRows(input)).toThrow(/is_nullable/i);
  });

  it('throws when an IndexRow is missing index_name', () => {
    const input = makeMinimalInput({
      indexes: [makeIndexRow({ index_name: undefined })],
    });
    expect(() => parseJsonRows(input)).toThrow(/index_name/i);
  });

  it('throws when a SequenceRow is missing sequence_name', () => {
    const input = makeMinimalInput({
      sequences: [makeSequenceRow({ sequence_name: undefined })],
    });
    expect(() => parseJsonRows(input)).toThrow(/sequence_name/i);
  });

  it('throws when a FkRow has invalid fk_id that cannot be coerced', () => {
    const input = makeMinimalInput({
      foreignKeys: [makeFkRow({ fk_id: 'NaN-value' })],
    });
    expect(() => parseJsonRows(input)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Complete round-trip: all families present and coerced correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonRows — full round-trip', () => {
  it('returns an object with all 11 MssqlRowInput keys', () => {
    const result = parseJsonRows(makeMinimalInput());
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining([
        'tables', 'columns', 'keyConstraints', 'foreignKeys',
        'checkConstraints', 'indexes', 'modules', 'triggerEvents',
        'sequences', 'extendedProperties', 'dependencies',
      ]),
    );
  });

  it('empty arrays are passed through as empty arrays', () => {
    const result = parseJsonRows({
      tables: [],
      columns: [],
      keyConstraints: [],
      foreignKeys: [],
      checkConstraints: [],
      indexes: [],
      modules: [],
      triggerEvents: [],
      sequences: [],
      extendedProperties: [],
      dependencies: [],
    });
    expect(result.tables).toHaveLength(0);
    expect(result.columns).toHaveLength(0);
  });
});
