/**
 * Committed planning-key DDL audit (v2, A5 — spec Req 1 anti-circularity carve-out).
 *
 * The three v2 planning families are the ONE carve-out from mechanical GT derivation: their keys
 * are HAND-PLANTED, HUMAN-AUDITED, and COMMITTED under `benchmark/planning-keys/`, each target
 * carrying a `source_ddl_ref` that cites the DDL fact justifying it. This suite PROVES, inside
 * `npm test`, that every planted fact is GREPPABLE-AUDITABLE against the cited span of the real
 * `test/fixtures/mssql/torture.sql` (v2 POSITIVE) — and that a key whose cited span does NOT
 * contain its fact FAILS LOUDLY naming the qid + target (v2 NEGATIVE). An unverifiable
 * hand-planted key is a SPEC VIOLATION, never a silent pass.
 *
 * `auditPlanKey` is PURE (takes the key object + the DDL text); this suite does the fs read. It
 * imports NO benchmark dev stage (independence guard) — the keys are committed data, not a run.
 *
 * L-009: EXACT assertions, positives AND negatives.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { auditPlanKey } from '../../benchmark/harness-checks.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const KEYS_DIR = join(repoRoot, 'benchmark', 'planning-keys');
const DDL_TEXT = readFileSync(join(repoRoot, 'test', 'fixtures', 'mssql', 'torture.sql'), 'utf8');

function loadKey(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(KEYS_DIR, name), 'utf8')) as Record<string, unknown>;
}

const CALLERS = loadKey('plan-callers-usp_log_change.json');
const BLINDSPOTS = loadKey('plan-blindspots-dynamic-sql.json');
const ORDER = loadKey('plan-order-drop-recreate.json');

// ─────────────────────────────────────────────────────────────────────────────
// Structural — the committed keys carry hand-planted provenance (never store-derived)
// ─────────────────────────────────────────────────────────────────────────────

describe('committed planning-keys carry hand-planted provenance (Req 1)', () => {
  for (const [name, key] of [
    ['plan-callers', CALLERS],
    ['plan-blindspots', BLINDSPOTS],
    ['plan-order', ORDER],
  ] as const) {
    it(`${name}: has a top-level source_ddl_ref string AND a per-target source_ddl_refs map`, () => {
      expect(typeof key['source_ddl_ref']).toBe('string');
      expect((key['source_ddl_ref'] as string).length).toBeGreaterThan(0);
      const refs = key['source_ddl_refs'] as Record<string, string>;
      expect(refs).toBeTypeOf('object');
      expect(Object.keys(refs).length).toBeGreaterThan(0);
    });
  }

  it('plan-callers pins the CALLEE usp_log_change and the complete caller set {usp_refresh_totals} (r1)', () => {
    expect(CALLERS['callee']).toBe('usp_log_change');
    expect(CALLERS['callers']).toStrictEqual(['usp_refresh_totals']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A5.3 — v2 POSITIVE: every planted fact IS present at its cited DDL span
// ─────────────────────────────────────────────────────────────────────────────

describe('auditPlanKey: every planted fact is auditable against its cited DDL (v2 positive)', () => {
  it('plan-callers — usp_refresh_totals calls usp_log_change at the cited span', () => {
    const results = auditPlanKey(CALLERS, DDL_TEXT);
    expect(results.length).toBe(1);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]?.target).toBe('usp_refresh_totals');
  });

  it('plan-blindspots — sp_dynamic_search carries a dynamic-SQL reference at the cited span', () => {
    const results = auditPlanKey(BLINDSPOTS, DDL_TEXT);
    expect(results.length).toBe(1);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]?.target).toBe('sp_dynamic_search');
  });

  it('plan-order — every precedence pair has both endpoints at its cited span', () => {
    const results = auditPlanKey(ORDER, DDL_TEXT);
    expect(results.length).toBe(5);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.target).sort()).toStrictEqual([
      'fn_net_amount->fn_round_money',
      'order_items->orders',
      'order_items->products',
      'products->regions',
      'usp_refresh_totals->usp_log_change',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A5.4 — v2 NEGATIVE: a fabricated / mis-cited ref FAILS LOUDLY naming qid + target
// ─────────────────────────────────────────────────────────────────────────────

describe('auditPlanKey: a source_ddl_ref lacking the fact FAILS audit (v2 negative)', () => {
  it('plan-callers — a span that names the caller but NOT the callee fails, naming qid + target', () => {
    // Lines 253-256 are the usp_refresh_totals header ONLY — the EXEC usp_log_change (:263) is
    // outside the span, so the CALL fact is absent. A fabricated ref must never silently pass.
    const badKey = {
      ...CALLERS,
      source_ddl_refs: { usp_refresh_totals: 'test/fixtures/mssql/torture.sql:253-256' },
    };
    const results = auditPlanKey(badKey, DDL_TEXT);
    const bad = results.find((r) => r.target === 'usp_refresh_totals');
    expect(bad?.ok).toBe(false);
    expect(bad?.detail).toContain('usp_refresh_totals'); // names the target
    expect(bad?.detail).toContain('plan-callers-usp_log_change'); // names the qid
  });

  it('plan-order — a pair whose cited span omits an endpoint fails, naming qid + target', () => {
    const badKey = {
      ...ORDER,
      source_ddl_refs: {
        ...(ORDER['source_ddl_refs'] as Record<string, string>),
        // :64 is orders.total_amount only — order_items is NOT in that span.
        'order_items->orders': 'test/fixtures/mssql/torture.sql:64',
      },
    };
    const results = auditPlanKey(badKey, DDL_TEXT);
    const bad = results.find((r) => r.target === 'order_items->orders');
    expect(bad?.ok).toBe(false);
    expect(bad?.detail).toContain('order_items->orders');
    expect(bad?.detail).toContain('plan-order-drop-recreate');
  });

  it('a target with a MISSING source_ddl_ref entry fails (never a silent pass)', () => {
    const badKey = { ...BLINDSPOTS, source_ddl_refs: {} };
    const results = auditPlanKey(badKey, DDL_TEXT);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0]?.detail).toContain('sp_dynamic_search');
  });
});
