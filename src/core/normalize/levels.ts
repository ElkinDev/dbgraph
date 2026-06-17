/**
 * Level application (off / metadata / full) and body normalization.
 * Design §5.4, §5.5 — centralizes level logic so it is applied identically everywhere.
 * US-003: metadata keeps node+edges but no body; full includes normalized body + FTS.
 * ADR-005/008: body whitespace normalization ensures bodyHash is stable across environments.
 * This file imports NOTHING from adapters, drivers, mcp, or cli (ADR-004).
 */

import { createHash } from 'node:crypto';
import type { IndexLevel } from '../model/node.js';

// ─────────────────────────────────────────────────────────────────────────────
// Body normalization (ADR-005 / §5.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a procedure/trigger body for stable hashing and storage:
 * 1. Normalizes CRLF → LF.
 * 2. Trims trailing whitespace on each line.
 * 3. Drops a trailing newline from the result.
 *
 * Does NOT re-format SQL or alter semantics — purely whitespace canonicalization.
 * Idempotent: normalizing twice yields the same output.
 */
export function normalizeBody(body: string): string {
  const normalized = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n$/, '');
  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Level application result type
// ─────────────────────────────────────────────────────────────────────────────

/** Result of applying a level to a node's body/comment context. */
export interface LevelResult {
  /** Normalized body — present only at level='full' and only when body was supplied. */
  readonly body?: string;
  /** SHA-1 hash of normalized body (ADR-005); null when body is absent or level≠'full'. */
  readonly bodyHash: string | null;
  /** FTS body text: normalized body at 'full', empty string otherwise (US-003). */
  readonly ftsBody: string;
  /** Comment/description preserved from input. */
  readonly comment?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// applyLevel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies an indexing level to a node's body/comment context.
 *
 * - `off`      → returns null (caller MUST NOT produce a node or FTS row).
 * - `metadata` → returns LevelResult with no body, null bodyHash, empty ftsBody.
 * - `full`     → returns LevelResult with normalized body (if supplied), sha1 bodyHash,
 *                and ftsBody populated with the normalized body for FTS indexing.
 *
 * @param input - The level and optional body/comment for the node.
 * @returns LevelResult for metadata/full, or null for off.
 */
export function applyLevel(input: {
  level: IndexLevel;
  body?: string;
  comment?: string;
}): LevelResult | null {
  const { level, body, comment } = input;

  if (level === 'off') {
    return null;
  }

  if (level === 'metadata') {
    const result: LevelResult = {
      bodyHash: null,
      ftsBody: '',
      ...(comment !== undefined ? { comment } : {}),
    };
    return result;
  }

  // level === 'full'
  if (body !== undefined && body !== '') {
    const normalized = normalizeBody(body);
    const bodyHash = createHash('sha1').update(normalized, 'utf8').digest('hex');
    const result: LevelResult = {
      body: normalized,
      bodyHash,
      ftsBody: normalized,
      ...(comment !== undefined ? { comment } : {}),
    };
    return result;
  }

  // full but no body supplied
  const result: LevelResult = {
    bodyHash: null,
    ftsBody: '',
    ...(comment !== undefined ? { comment } : {}),
  };
  return result;
}
