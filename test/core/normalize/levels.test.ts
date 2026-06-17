/**
 * RED test: level application (off/metadata/full) effects on payload body, bodyHash, FTS body flag.
 * Design §5.4, §5.5 — level honoring; body whitespace normalization.
 * References: graph-normalization spec "Level honoring", US-003.
 */

import { describe, it, expect } from 'vitest';
import { applyLevel, normalizeBody } from '../../../src/core/normalize/levels.js';
import type { IndexLevel } from '../../../src/core/model/node.js';

// Minimal GraphNode-like input that applyLevel works on
interface LevelInput {
  level: IndexLevel;
  body?: string;
  comment?: string;
}

describe('normalizeBody', () => {
  it('trims trailing whitespace per line', () => {
    expect(normalizeBody('SELECT *   \nFROM t  ')).toBe('SELECT *\nFROM t');
  });

  it('normalizes CRLF line endings to LF', () => {
    expect(normalizeBody('line1\r\nline2')).toBe('line1\nline2');
  });

  it('drops a trailing newline', () => {
    expect(normalizeBody('SELECT *\n')).toBe('SELECT *');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeBody('')).toBe('');
  });

  it('is idempotent: normalizing twice yields the same result', () => {
    const body = 'BEGIN\r\n  SELECT *   \r\nEND\r\n';
    expect(normalizeBody(normalizeBody(body))).toBe(normalizeBody(body));
  });
});

describe('applyLevel — off', () => {
  it('returns null to signal no node should be produced', () => {
    const result = applyLevel({ level: 'off', body: 'SELECT 1', comment: 'hi' });
    expect(result).toBeNull();
  });
});

describe('applyLevel — metadata', () => {
  const input: LevelInput = { level: 'metadata', body: 'SELECT * FROM t', comment: 'a proc' };

  it('returns a result (node should be produced)', () => {
    expect(applyLevel(input)).not.toBeNull();
  });

  it('omits body from the result payload', () => {
    const result = applyLevel(input);
    expect(result?.body).toBeUndefined();
  });

  it('sets bodyHash to null', () => {
    const result = applyLevel(input);
    expect(result?.bodyHash).toBeNull();
  });

  it('sets ftsBody to empty string (body not indexed)', () => {
    const result = applyLevel(input);
    expect(result?.ftsBody).toBe('');
  });

  it('preserves comment', () => {
    const result = applyLevel(input);
    expect(result?.comment).toBe('a proc');
  });
});

describe('applyLevel — full', () => {
  const rawBody = 'BEGIN\r\n  SELECT *   \r\nEND\r\n';
  const input: LevelInput = { level: 'full', body: rawBody, comment: 'a proc' };

  it('returns a result (node should be produced)', () => {
    expect(applyLevel(input)).not.toBeNull();
  });

  it('includes normalized body in result', () => {
    const result = applyLevel(input);
    expect(result?.body).toBe('BEGIN\n  SELECT *\nEND');
  });

  it('sets bodyHash to sha1 of normalized body (40 hex chars)', () => {
    const result = applyLevel(input);
    expect(result?.bodyHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('bodyHash is deterministic for the same body', () => {
    const r1 = applyLevel(input);
    const r2 = applyLevel(input);
    expect(r1?.bodyHash).toBe(r2?.bodyHash);
  });

  it('bodyHash differs if body differs', () => {
    const other = applyLevel({ level: 'full', body: 'SELECT 1' });
    expect(applyLevel(input)?.bodyHash).not.toBe(other?.bodyHash);
  });

  it('sets ftsBody to the normalized body (indexed for FTS)', () => {
    const result = applyLevel(input);
    expect(result?.ftsBody).toBe('BEGIN\n  SELECT *\nEND');
  });

  it('preserves comment', () => {
    const result = applyLevel(input);
    expect(result?.comment).toBe('a proc');
  });
});

describe('applyLevel — full with no body', () => {
  it('returns result with null bodyHash and empty ftsBody when body is absent', () => {
    const result = applyLevel({ level: 'full' });
    expect(result).not.toBeNull();
    expect(result?.body).toBeUndefined();
    expect(result?.bodyHash).toBeNull();
    expect(result?.ftsBody).toBe('');
  });
});

describe('bodyHash stability (ADR-005/008)', () => {
  it('CRLF and LF versions of the same body produce the same bodyHash', () => {
    const crlf = applyLevel({ level: 'full', body: 'BEGIN\r\n  SELECT *\r\nEND' });
    const lf = applyLevel({ level: 'full', body: 'BEGIN\n  SELECT *\nEND' });
    expect(crlf?.bodyHash).toBe(lf?.bodyHash);
  });

  it('trailing-whitespace variants produce the same bodyHash', () => {
    const trailing = applyLevel({ level: 'full', body: 'SELECT *   ' });
    const clean = applyLevel({ level: 'full', body: 'SELECT *' });
    expect(trailing?.bodyHash).toBe(clean?.bodyHash);
  });
});
