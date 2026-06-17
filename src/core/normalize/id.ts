/**
 * Deterministic node/edge ID derivation and canonical qualified-name helpers.
 * Design §3.4, ADR-008 — IDs are pure functions of semantic identity.
 * Uses Node's built-in crypto (ADR-007: no new dependencies).
 * This file imports NOTHING from adapters, drivers, mcp, or cli (ADR-004).
 */

import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Canonical qualified-name derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips SQL identifier quoting (brackets or double-quotes) from a single
 * identifier segment, then case-folds to lowercase.
 */
function unquote(segment: string): string {
  // Strip surrounding [brackets] or "double quotes"
  const stripped = segment.replace(/^\[(.+)]$/, '$1').replace(/^"(.+)"$/, '$1');
  return stripped.toLowerCase();
}

/**
 * Returns the canonical qualified name for a node: case-folded, quote-stripped,
 * segments joined by '.'. If schema is null, returns just the name.
 *
 * @example
 *   canonicalQName('DBO', 'Orders') // → 'dbo.orders'
 *   canonicalQName('[dbo]', '[Orders]') // → 'dbo.orders'
 *   canonicalQName(null, 'my_db') // → 'my_db'
 */
export function canonicalQName(schema: string | null, name: string): string {
  const n = unquote(name);
  if (schema === null) return n;
  return `${unquote(schema)}.${n}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA-1 helper (Node crypto, ADR-007)
// ─────────────────────────────────────────────────────────────────────────────

function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Node ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives a deterministic node ID from a node kind and its canonical qualified name.
 * Formula: sha1(kind + ' ' + canonicalQName)
 *
 * The kind prefix prevents collisions between e.g. a table and a view sharing
 * a name in different namespaces. The qname is case-folded by the caller
 * or via canonicalQName(), so IDs are case-insensitive.
 *
 * Stubs reuse the SAME derivation from the referenced qname — a later real
 * extraction of that object lands on the SAME node ID (idempotent upsert).
 */
export function nodeId(kind: string, qname: string): string {
  return sha1(`${kind} ${qname.toLowerCase()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives a deterministic edge ID from edge kind, source id, destination id,
 * and a discriminator string that makes parallel edges distinct.
 *
 * Discriminator usage:
 *  - 'references' per-column: 'srcColumn>dstColumn'
 *  - 'references' aggregated: 'aggregate'
 *  - 'fires_on':             the event ('INSERT' | 'UPDATE' | 'DELETE')
 *  - edges that cannot duplicate: '' (empty string)
 *
 * Formula: sha1(kind + ' ' + src_id + ' ' + dst_id + ' ' + discriminator)
 */
export function edgeId(
  kind: string,
  srcId: string,
  dstId: string,
  discriminator: string,
): string {
  return sha1(`${kind} ${srcId} ${dstId} ${discriminator}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable JSON serialization (sorted keys, ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializes a value to JSON with recursively sorted object keys so that the
 * output is byte-identical for the same structural value regardless of the
 * property insertion order.  Arrays preserve their element order.
 *
 * Used in the normalizer to ensure payload/attrs JSON is deterministic (§5.6).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}
