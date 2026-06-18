/**
 * dbgraph affected command test — task 4.5 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph affected <script.sql> mirrors precheck via the CLI.
 *   - reads a .sql file, calls src/core/precheck/ core (NOT src/mcp/**)
 *   - --json: stable machine-readable output
 *   - exit 1 when objects affected, exit 0 when none
 *
 * TDD: RED (module not found) → GREEN → verify exit codes.
 * ADR-004: affected.ts imports from barrel only, NEVER from src/mcp/**.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { runAffected } from '../../../src/cli/commands/affected.js';
import { openFixtureStore, type FixtureStore } from '../../mcp/fixture.js';

let fx: FixtureStore;
let tmpDir: string;
let affectedSqlPath: string;
let emptyDdlPath: string;
let unmatchedDdlPath: string;

beforeAll(async () => {
  fx = await openFixtureStore();
  tmpDir = join(tmpdir(), `dbgraph-affected-test-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  // SQL file with DDL that affects main.employees (exists in fixture)
  affectedSqlPath = join(tmpDir, 'affected.sql');
  writeFileSync(affectedSqlPath,
    'ALTER TABLE main.employees ADD COLUMN priority INT;\nDROP INDEX idx_emp_dept ON main.employees;',
    'utf-8',
  );

  // Empty SQL file — no DDL
  emptyDdlPath = join(tmpDir, 'empty.sql');
  writeFileSync(emptyDdlPath, '', 'utf-8');

  // SQL with only unmatched identifiers (no impact)
  unmatchedDdlPath = join(tmpDir, 'unmatched.sql');
  writeFileSync(unmatchedDdlPath, 'ALTER TABLE completely_nonexistent_table ADD COLUMN x INT;', 'utf-8');
});

afterAll(async () => {
  await fx.cleanup();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: exit codes
// ─────────────────────────────────────────────────────────────────────────────

describe('runAffected — exit codes', () => {
  it('returns negative outcome (exit 1) when DDL affects graph nodes', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath });
    expect(result.type).toBe('negative');
  });

  it('returns success outcome (exit 0) when DDL affects no graph nodes', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: unmatchedDdlPath });
    expect(result.type).toBe('success');
  });

  it('returns success outcome (exit 0) for empty SQL file', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: emptyDdlPath });
    expect(result.type).toBe('success');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: text output
// ─────────────────────────────────────────────────────────────────────────────

describe('runAffected — text output', () => {
  it('text output is non-empty when objects affected', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath });
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('output contains DDL PRECHECK header', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath });
    expect(result.output).toContain('DDL PRECHECK');
  });

  it('output contains employees for the affected DDL', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath });
    expect(result.output).toContain('employees');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: JSON mode
// ─────────────────────────────────────────────────────────────────────────────

describe('runAffected — --json mode', () => {
  it('json output is valid JSON', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath, json: true });
    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  it('json output contains matchedObjects array', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath, json: true });
    const parsed = JSON.parse(result.output) as Record<string, unknown>;
    expect(parsed).toHaveProperty('matchedObjects');
    expect(Array.isArray(parsed['matchedObjects'])).toBe(true);
  });

  it('json output has confidence: parsed on all matched objects', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath, json: true });
    const parsed = JSON.parse(result.output) as { matchedObjects: Array<{ confidence: string }> };
    for (const item of parsed.matchedObjects) {
      expect(item.confidence).toBe('parsed');
    }
  });

  it('json output has type negative when objects affected', async () => {
    const result = await runAffected({ store: fx.store, sqlFile: affectedSqlPath, json: true });
    expect(result.type).toBe('negative');
  });

  it('json output is stable on re-run (byte-identical)', async () => {
    const r1 = await runAffected({ store: fx.store, sqlFile: affectedSqlPath, json: true });
    const r2 = await runAffected({ store: fx.store, sqlFile: affectedSqlPath, json: true });
    expect(r1.output).toBe(r2.output);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: file not found
// ─────────────────────────────────────────────────────────────────────────────

describe('runAffected — file errors', () => {
  it('throws or rejects for a non-existent SQL file', async () => {
    await expect(
      runAffected({ store: fx.store, sqlFile: join(tmpDir, 'does-not-exist.sql') }),
    ).rejects.toThrow();
  });
});
