/**
 * MongoDB document sampling + type-merge + DISCARD.
 * Design §"sample-walk + DISCARD": walk each sampled doc's keys into a
 * Map<path,{types:Set<string>;count:number}> accumulator, then compute
 * frequency = count / sampledCount and dataType = mergeDataTypes(types).
 * DISCARD every document after the pass — only the accumulator survives.
 *
 * sampleCollections(docs) — pure function over an already-sampled document array.
 * The caller (mongodb-schema-adapter.ts) fetches docs via driver.sample(); this
 * function receives them and returns typed RawField[]. Documents are NOT stored.
 *
 * Path encoding:
 *   nested subdocument → dotted path (address.city)
 *   array of subdocuments → items[].sku (walk first element only — type-representative)
 *   array of scalars → emitted as a scalar field with dataType '<elemType>[]'
 *   plain scalar → leaf field
 *
 * Security invariant (dbgraph-security / US-031):
 *   After this function returns, NO document value survives.
 *   The returned RawField[] contains ONLY name, dataType, frequency, nullable.
 *
 * NO top-level mongodb import (ADR-006).
 * Deterministic output: fields sorted by path (ADR-008).
 *
 * US-030 (MongoDB adapter), dbgraph-security (values-NEVER-persisted).
 */

import type { RawField } from '../../../core/model/catalog.js';
import { bsonToDataType, mergeDataTypes } from './type-map.js';

// ─────────────────────────────────────────────────────────────────────────────
// Accumulator entry — internal only, never exported
// ─────────────────────────────────────────────────────────────────────────────

interface PathAccumulator {
  types: Set<string>;
  count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal walk — recurse into a document and populate the accumulator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walks a single document's keys recursively.
 * Each leaf path is recorded in the accumulator with its observed BSON type.
 *
 * Encoding rules:
 *   - Scalar field at top level: key → leaf
 *   - Nested subdocument: walk into it with prefix "key."
 *   - Array of subdocuments: walk first element with prefix "key[]."
 *   - Array of scalars: record "key" with the array dataType ('string[]' etc.)
 *
 * @param doc    - A single sampled document (plain JS object).
 * @param prefix - Dotted path prefix for nested recursion.
 * @param acc    - The accumulator Map to update.
 */
function walkDoc(
  doc: Record<string, unknown>,
  prefix: string,
  acc: Map<string, PathAccumulator>,
): void {
  for (const key of Object.keys(doc)) {
    const value = doc[key];
    const path = prefix === '' ? key : `${prefix}.${key}`;

    if (value !== null && !Array.isArray(value) && typeof value === 'object') {
      // Check if it's a BSON wrapper (has _bsontype) — treat as scalar
      const bsonType = (value as Record<string, unknown>)['_bsontype'];
      if (typeof bsonType === 'string') {
        // BSON wrapper — treat as leaf scalar
        recordLeaf(path, value, acc);
      } else {
        // Plain subdocument — recurse with dotted prefix
        walkDoc(value as Record<string, unknown>, path, acc);
      }
    } else if (Array.isArray(value)) {
      // Array field
      if (value.length > 0) {
        const firstElem = value[0];
        if (
          firstElem !== null &&
          typeof firstElem === 'object' &&
          !Array.isArray(firstElem) &&
          (firstElem as Record<string, unknown>)['_bsontype'] === undefined
        ) {
          // Array of subdocuments — walk first element with items[]
          walkDoc(firstElem as Record<string, unknown>, `${path}[]`, acc);
        } else {
          // Array of scalars — record as leaf with array dataType
          recordLeaf(path, value, acc);
        }
      } else {
        // Empty array — record as unknown[]
        recordLeaf(path, value, acc);
      }
    } else {
      // Scalar leaf (string, number, boolean, null, Date, etc.)
      recordLeaf(path, value, acc);
    }
  }
}

/**
 * Records a single leaf path+value observation in the accumulator.
 * Only the BSON type string is stored — the VALUE is discarded immediately.
 */
function recordLeaf(
  path: string,
  value: unknown,
  acc: Map<string, PathAccumulator>,
): void {
  const dataType = bsonToDataType(value);
  let entry = acc.get(path);
  if (entry === undefined) {
    entry = { types: new Set(), count: 0 };
    acc.set(path, entry);
  }
  entry.types.add(dataType);
  entry.count++;
  // VALUE is NOT stored — only the type string is retained (DISCARD invariant).
}

// ─────────────────────────────────────────────────────────────────────────────
// sampleCollections — public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walks an array of sampled MongoDB documents and returns a sorted RawField[]
 * containing type and frequency metadata ONLY — no document values.
 *
 * Algorithm:
 *   1. For each document, walk keys recursively into the accumulator.
 *   2. For each path in the accumulator:
 *        frequency = count / docs.length
 *        dataType  = mergeDataTypes(types)
 *        nullable  = frequency < 1 || types.has('null')
 *   3. Sort paths alphabetically (determinism — ADR-008).
 *   4. DISCARD all documents and the accumulator — only the RawField[] survives.
 *
 * @param docs - Array of sampled documents (readonly — never mutated).
 * @returns Sorted RawField[] with only name/dataType/frequency/nullable.
 */
export function sampleCollections(docs: readonly Record<string, unknown>[]): RawField[] {
  if (docs.length === 0) return [];

  const sampledCount = docs.length;
  const acc = new Map<string, PathAccumulator>();

  // Walk each document — only type strings accumulate, values are discarded immediately
  for (const doc of docs) {
    walkDoc(doc, '', acc);
  }

  // Build sorted RawField[] — accumulator values only (no doc values survive)
  const paths = Array.from(acc.keys()).sort(); // deterministic (ADR-008)

  const fields: RawField[] = paths.map((path) => {
    // acc.get(path) is guaranteed to exist — we just iterated acc.keys()
    const entry = acc.get(path)!;
    const frequency = entry.count / sampledCount;
    const dataType = mergeDataTypes(entry.types);
    const nullable = frequency < 1 || entry.types.has('null');

    return {
      name: path,
      dataType,
      frequency,
      nullable,
    };
  });

  // Accumulator is no longer referenced after this point — GC will clean it.
  // Documents were already discarded (we hold no reference to their values).
  return fields;
}
