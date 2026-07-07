/**
 * Tests for src/cli/parse/detail.ts — explore-payloads C.1 (design D4).
 * Spec: cli-config "explore and object reject an unknown --detail value"
 *   (scenarios: unknown --detail exits 2 with an actionable message; valid values unaffected).
 *
 * `parseDetail(raw: unknown): ExploreDetail` is the ONE pure validator reused by
 * handleExplore / handleAffected / handleObject. It returns the value for the exact
 * set brief|normal|full, defaults undefined → 'normal', and THROWS a ConfigError
 * (a DbgraphError → exit 2 per exit-code.ts) naming the offending value for anything
 * else. It MUST NOT silently coerce garbage to 'normal' (the pre-change correctness trap).
 *
 * TDD: RED (module does not exist) → GREEN → TRIANGULATE (multiple valid + invalid inputs).
 */

import { describe, it, expect } from 'vitest';
import { parseDetail } from '../../../src/cli/parse/detail.js';
import { ConfigError } from '../../../src/index.js';

describe('parseDetail — accepts the exact brief|normal|full set', () => {
  it('returns "brief" for "brief"', () => {
    expect(parseDetail('brief')).toBe('brief');
  });

  it('returns "normal" for "normal"', () => {
    expect(parseDetail('normal')).toBe('normal');
  });

  it('returns "full" for "full"', () => {
    expect(parseDetail('full')).toBe('full');
  });
});

describe('parseDetail — undefined defaults to "normal"', () => {
  it('returns "normal" when the flag is absent (undefined)', () => {
    expect(parseDetail(undefined)).toBe('normal');
  });
});

describe('parseDetail — rejects unknown values with a naming ConfigError', () => {
  it('throws a ConfigError for "bogus" naming the offending value (exact message shape)', () => {
    expect(() => parseDetail('bogus')).toThrow(ConfigError);
    expect(() => parseDetail('bogus')).toThrow(
      'explore: "detail" must be one of brief|normal|full (got "bogus")',
    );
  });

  it('names a DIFFERENT invalid value in the message (triangulation — not a hardcoded "bogus")', () => {
    expect(() => parseDetail('verbose')).toThrow(
      'explore: "detail" must be one of brief|normal|full (got "verbose")',
    );
  });

  it('rejects a case-mismatched value (the set is exact, not case-insensitive)', () => {
    expect(() => parseDetail('BRIEF')).toThrow(ConfigError);
    expect(() => parseDetail('BRIEF')).toThrow(
      'explore: "detail" must be one of brief|normal|full (got "BRIEF")',
    );
  });

  it('rejects a bare boolean flag value (--detail with no argument → true)', () => {
    // parseArgv yields `true` for a bare `--detail`; that is NOT a valid level.
    expect(() => parseDetail(true)).toThrow(ConfigError);
    expect(() => parseDetail(true)).toThrow(
      'explore: "detail" must be one of brief|normal|full (got "true")',
    );
  });

  it('does NOT silently coerce an unknown value to "normal"', () => {
    // The pre-change trap: garbage silently became 'normal'. That MUST now throw.
    expect(() => parseDetail('nrmal')).toThrow(ConfigError);
  });
});
