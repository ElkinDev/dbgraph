/**
 * Unit tests for loadOptionalDriver — the centralized optional-driver loading seam.
 * Design D7 / Q1 (phase-9.5c): one seam makes binary (SEA) driver resolution
 * DETERMINISTIC while the off-SEA branch stays byte-identical to today's
 * `await import(name)` — so every existing factory test + golden holds.
 *
 *   SEA branch  (isSea()===true):  createRequire from an explicit base —
 *                                  process.cwd() FIRST, then process.execPath —
 *                                  honoring $CWD/node_modules → NODE_PATH → global.
 *   off-SEA     (isSea()===false): literally `await import(name)`.
 *   resolution miss:               RETHROWS → callers' existing catch → npm i <name>.
 *
 * All seams (isSea / createRequire / importModule) are INJECTED so the branches are
 * unit-testable without a real SEA and without uninstalling any driver.
 *
 * TDD: RED (module does not exist yet) → GREEN.
 * Spec scenario R3 "Live-DB command without a driver fails…", design D7, Q1 (D7 full).
 */

import { describe, it, expect } from 'vitest';
import { dirname } from 'node:path';
import { loadOptionalDriver } from '../../../../src/adapters/engines/_shared/load-optional-driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// SEA branch — createRequire resolution (cwd first, then execPath)
// ─────────────────────────────────────────────────────────────────────────────

describe('loadOptionalDriver — SEA branch (createRequire, cwd → execPath)', () => {
  it('resolves from a CWD-anchored base FIRST (base directory === process.cwd())', async () => {
    const bases: string[] = [];
    const sentinel = { driver: 'pg-from-cwd' };

    const result = await loadOptionalDriver('pg', {
      isSea: () => true,
      createRequire: (base: string) => {
        bases.push(base);
        return () => sentinel;
      },
    });

    expect(result).toBe(sentinel);
    expect(bases.length).toBe(1); // resolved on the first (cwd) attempt — no fallback needed
    expect(dirname(bases[0] ?? '')).toBe(process.cwd());
  });

  it('falls back to a process.execPath base when the CWD base cannot resolve', async () => {
    const bases: string[] = [];
    const sentinel = { driver: 'pg-from-execpath' };

    const result = await loadOptionalDriver('pg', {
      isSea: () => true,
      createRequire: (base: string) => {
        bases.push(base);
        return (id: string): unknown => {
          if (base === process.execPath) return sentinel;
          throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' });
        };
      },
    });

    expect(result).toBe(sentinel);
    expect(bases.length).toBe(2);
    expect(dirname(bases[0] ?? '')).toBe(process.cwd()); // cwd tried first
    expect(bases[1]).toBe(process.execPath); // execPath tried second
  });

  it('rethrows the ORIGINAL (cwd) resolution error when BOTH bases miss (→ callers npm i)', async () => {
    const cwdError = Object.assign(new Error("Cannot find module 'pg'"), { code: 'MODULE_NOT_FOUND' });

    const rejected = await loadOptionalDriver('pg', {
      isSea: () => true,
      createRequire: (base: string) => (id: string): unknown => {
        if (dirname(base) === process.cwd()) throw cwdError;
        throw new Error(`execPath miss for ${id}`);
      },
    }).catch((e: unknown) => e);

    expect(rejected).toBe(cwdError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// off-SEA branch — dynamic import(name), byte-identical to today
// ─────────────────────────────────────────────────────────────────────────────

describe('loadOptionalDriver — off-SEA branch (dynamic import(name))', () => {
  it('calls the injected import seam with the exact driver name and returns its module', async () => {
    let seen = '';
    const sentinel = { driver: 'mysql2-promise-mod' };

    const result = await loadOptionalDriver('mysql2/promise', {
      isSea: () => false,
      importModule: (n: string): Promise<unknown> => {
        seen = n;
        return Promise.resolve(sentinel);
      },
    });

    expect(seen).toBe('mysql2/promise');
    expect(result).toBe(sentinel);
  });

  it('default off-SEA path performs a real dynamic import(name) (node builtin proves the seam)', async () => {
    const osMod = await loadOptionalDriver('node:os', { isSea: () => false });
    expect(typeof (osMod as { platform: unknown }).platform).toBe('function');
  });

  it('rethrows the import rejection so the callers existing MODULE_NOT_FOUND catch fires', async () => {
    const miss = Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });

    const rejected = await loadOptionalDriver('pg', {
      isSea: () => false,
      importModule: (): Promise<unknown> => {
        throw miss;
      },
    }).catch((e: unknown) => e);

    expect(rejected).toBe(miss);
  });
});
