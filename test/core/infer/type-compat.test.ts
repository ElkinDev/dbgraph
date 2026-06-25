/**
 * RED test: type-family classification and compatibility check.
 * Spec: graph-normalization "Type compatibility gates inferred edges".
 * Design D-T type-compat table.
 * ADR-004 / ADR-008 / L-009 exact-set assertions.
 *
 * US-008
 */

import { describe, it, expect } from 'vitest';
import { typeFamily, compatible } from '../../../src/core/infer/type-compat.js';

// ─────────────────────────────────────────────────────────────────────────────
// typeFamily — family classification (case-folded)
// ─────────────────────────────────────────────────────────────────────────────

describe('typeFamily', () => {
  it("maps 'int' to 'int' family", () => {
    expect(typeFamily('int')).toBe('int');
  });

  it("maps 'INT' (uppercase) to 'int' family (case-fold)", () => {
    expect(typeFamily('INT')).toBe('int');
  });

  it("maps 'integer' to 'int' family", () => {
    expect(typeFamily('integer')).toBe('int');
  });

  it("maps 'bigint' to 'int' family", () => {
    expect(typeFamily('bigint')).toBe('int');
  });

  it("maps 'smallint' to 'int' family", () => {
    expect(typeFamily('smallint')).toBe('int');
  });

  it("maps 'serial' to 'int' family", () => {
    expect(typeFamily('serial')).toBe('int');
  });

  it("maps 'bigserial' to 'int' family", () => {
    expect(typeFamily('bigserial')).toBe('int');
  });

  // INT family: same result across aliases (task spec assertion)
  it("typeFamily('INT') === typeFamily('bigint') === 'int'", () => {
    expect(typeFamily('INT')).toBe('int');
    expect(typeFamily('bigint')).toBe('int');
    expect(typeFamily('INT')).toBe(typeFamily('bigint'));
  });

  // OID family
  it("maps 'objectid' to 'oid' family (case-fold)", () => {
    expect(typeFamily('objectid')).toBe('oid');
  });

  it("maps 'ObjectId' to 'oid' family (case-fold)", () => {
    expect(typeFamily('ObjectId')).toBe('oid');
  });

  it("maps '_id' to 'oid' family", () => {
    expect(typeFamily('_id')).toBe('oid');
  });

  // UUID family
  it("maps 'uuid' to 'uuid' family", () => {
    expect(typeFamily('uuid')).toBe('uuid');
  });

  it("maps 'UUID' to 'uuid' family (case-fold)", () => {
    expect(typeFamily('UUID')).toBe('uuid');
  });

  // STR family
  it("maps 'varchar' to 'str' family", () => {
    expect(typeFamily('varchar')).toBe('str');
  });

  it("maps 'text' to 'str' family", () => {
    expect(typeFamily('text')).toBe('str');
  });

  it("maps 'char' to 'str' family", () => {
    expect(typeFamily('char')).toBe('str');
  });

  it("maps 'nvarchar' to 'str' family", () => {
    expect(typeFamily('nvarchar')).toBe('str');
  });

  it("maps 'string' to 'str' family", () => {
    expect(typeFamily('string')).toBe('str');
  });

  // Unknown type → own folded token (NEVER silently 'int')
  it('maps unknown type to its own lowercased token', () => {
    expect(typeFamily('money')).toBe('money');
  });

  it('maps unknown type BOOLEAN (uppercase) to its own lowercased token', () => {
    expect(typeFamily('BOOLEAN')).toBe('boolean');
  });

  it('unknown type is never silently mapped to int', () => {
    expect(typeFamily('float')).not.toBe('int');
    expect(typeFamily('decimal')).not.toBe('int');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// compatible — full boolean exact-set table (L-009)
// ─────────────────────────────────────────────────────────────────────────────

describe('compatible', () => {
  // ── Compatible pairs ──────────────────────────────────────────────────────

  it('int ↔ bigint are compatible', () => {
    expect(compatible('int', 'bigint')).toBe(true);
    expect(compatible('bigint', 'int')).toBe(true);
  });

  it('int ↔ smallint are compatible', () => {
    expect(compatible('int', 'smallint')).toBe(true);
    expect(compatible('smallint', 'int')).toBe(true);
  });

  it('int ↔ integer are compatible (same family)', () => {
    expect(compatible('int', 'integer')).toBe(true);
  });

  it('int ↔ serial are compatible', () => {
    expect(compatible('int', 'serial')).toBe(true);
  });

  it('bigint ↔ bigserial are compatible', () => {
    expect(compatible('bigint', 'bigserial')).toBe(true);
  });

  it('ObjectId ↔ _id are compatible (case-folded, oid family)', () => {
    expect(compatible('ObjectId', '_id')).toBe(true);
    expect(compatible('_id', 'ObjectId')).toBe(true);
  });

  it('objectid ↔ _id are compatible (lowercase)', () => {
    expect(compatible('objectid', '_id')).toBe(true);
  });

  it('string ↔ varchar are compatible', () => {
    expect(compatible('string', 'varchar')).toBe(true);
    expect(compatible('varchar', 'string')).toBe(true);
  });

  it('varchar ↔ text are compatible', () => {
    expect(compatible('varchar', 'text')).toBe(true);
  });

  it('text ↔ nvarchar are compatible', () => {
    expect(compatible('text', 'nvarchar')).toBe(true);
  });

  it('same type is compatible with itself (reflexive)', () => {
    expect(compatible('int', 'int')).toBe(true);
    expect(compatible('uuid', 'uuid')).toBe(true);
    expect(compatible('varchar', 'varchar')).toBe(true);
  });

  // ── Incompatible pairs (EXACT FALSE assertions) ───────────────────────────

  it('int ↔ uuid is NOT compatible', () => {
    expect(compatible('int', 'uuid')).toBe(false);
    expect(compatible('uuid', 'int')).toBe(false);
  });

  it('string ↔ int is NOT compatible', () => {
    expect(compatible('string', 'int')).toBe(false);
    expect(compatible('int', 'string')).toBe(false);
  });

  it('uuid ↔ varchar is NOT compatible', () => {
    expect(compatible('uuid', 'varchar')).toBe(false);
    expect(compatible('varchar', 'uuid')).toBe(false);
  });

  it('objectid ↔ uuid is NOT compatible (oid ≠ uuid)', () => {
    expect(compatible('objectid', 'uuid')).toBe(false);
  });

  it('int ↔ text is NOT compatible', () => {
    expect(compatible('int', 'text')).toBe(false);
  });

  it('unknown types with different tokens are NOT compatible', () => {
    expect(compatible('money', 'boolean')).toBe(false);
  });

  it('unknown type is compatible with itself (same token)', () => {
    // same unknown token → same family → compatible
    expect(compatible('money', 'money')).toBe(true);
  });
});
