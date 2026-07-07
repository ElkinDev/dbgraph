/**
 * CLI hexagonal boundary enforcement test — task 7.2 (phase-4-cli-config).
 * Design Decision 7: any src/cli/** file that imports src/adapters/** or a
 * forbidden DB driver MUST FAIL this test.
 *
 * Reuses the dependency-free scanner pattern from test/core/boundaries.test.ts:
 *   collectTsFiles + extractImportSpecifiers (regex, no module graph walk).
 *
 * Legal imports for src/cli/**:
 *   - Relative paths that resolve to src/index.ts or src/core/** (via ../index.js
 *     or path segments that do not contain /adapters/)
 *   - @niklerk23/dbgraph (package-level barrel)
 *   - node:* builtins
 *   - Other src/cli/** sibling imports
 *
 * Forbidden:
 *   - Any specifier containing /adapters/ (catches relative imports into the
 *     adapter layer: ../../adapters/..., ../../../adapters/..., etc.)
 *   - Direct DB driver package imports: better-sqlite3, mssql, pg, mysql2, mongodb
 *   - src/mcp/** imports (mcp layer must not be imported by cli)
 *
 * Red-green proof: the test includes a "planted import" describe block that
 * dynamically builds a probe source string containing a forbidden adapter import
 * and asserts that the scanner detects it. This proves the test WOULD have failed
 * before this batch wired the boundary correctly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// File scanner (mirrors test/core/boundaries.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  function walk(d: string): void {
    // Use the same pattern as test/core/boundaries.test.ts
    const entries = readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        result.push(full);
      }
    }
  }
  try {
    walk(dir);
  } catch {
    // directory does not exist yet — empty scan
  }
  return result;
}

/**
 * Extracts all import specifiers from a TypeScript source file.
 * Handles: static import, export from, and dynamic import().
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  // Static: import ... from 'specifier' / export ... from 'specifier'
  const staticRe = /(?:import|export)\s+(?:type\s+)?(?:[\w,{}\s*]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(source)) !== null) {
    if (m[1] !== undefined) specifiers.push(m[1]);
  }

  // Dynamic: import('specifier') or import("specifier")
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(source)) !== null) {
    if (m[1] !== undefined) specifiers.push(m[1]);
  }

  return specifiers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boundary rules for src/cli/**
// ─────────────────────────────────────────────────────────────────────────────

/** DB drivers that cli must never reference directly. */
const FORBIDDEN_DRIVERS = [
  'better-sqlite3',
  'mssql',
  'pg',
  'mysql2',
  'mongodb',
];

/**
 * Returns true when a specifier violates the CLI boundary.
 * The CLI MUST import ONLY:
 *   - src/index.ts (via ../index.js or ../../index.js etc.)
 *   - Other src/cli/** siblings (relative, containing /cli/ or no forbidden layer)
 *   - node:* builtins
 *   - @niklerk23/dbgraph (the package barrel)
 *
 * Forbidden:
 *   - Any relative path that traverses into /adapters/ (adapter layer)
 *   - Any relative path that traverses into /mcp/ (mcp layer)
 *   - Direct DB driver packages
 */
function isForbiddenForCli(specifier: string): boolean {
  // Relative imports into forbidden directories
  if (specifier.includes('/adapters/')) return true;
  if (specifier.includes('/mcp/')) return true;

  // Package-level drivers
  if (FORBIDDEN_DRIVERS.some((d) => specifier === d || specifier.startsWith(`${d}/`))) {
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project root
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// This file is at test/cli/boundaries.test.ts — two levels up is the project root
const projectRoot = resolve(__dirname, '../..');

const cliSrcDir = join(projectRoot, 'src', 'cli');

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('hexagonal boundary: src/cli must not import src/adapters, drivers, or mcp', () => {
  const cliFiles = collectTsFiles(cliSrcDir);

  it('finds at least one CLI TypeScript file to scan', () => {
    expect(cliFiles.length).toBeGreaterThan(0);
  });

  it('the viz command source is among the scanned CLI files (graph-viz 3.7b)', () => {
    // The viz assembly adapter must be covered by this boundary sweep (ADR-004).
    expect(cliFiles.some((f) => f.replace(/\\/g, '/').endsWith('src/cli/commands/viz.ts'))).toBe(true);
  });

  it('no CLI file imports from src/adapters/**, src/mcp/**, or DB drivers', () => {
    const violations: string[] = [];

    for (const filePath of cliFiles) {
      const source = readFileSync(filePath, 'utf-8');
      const specifiers = extractImportSpecifiers(source);

      for (const spec of specifiers) {
        if (isForbiddenForCli(spec)) {
          violations.push(`${filePath}\n  → imports "${spec}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `CLI boundary violations found:\n${violations.join('\n')}\n\n` +
          'Fix: src/cli/** must import ONLY from src/index.ts (via ../index.js), ' +
          'other src/cli/** siblings, or node:* builtins (ADR-004, Decision 7).',
      );
    }

    expect(violations).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Red-green proof: scanner bites on a planted adapter import
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI boundary scanner: negative control (proves the test would have failed)', () => {
  it('detects a relative import containing /adapters/', () => {
    // Simulate a CLI module that illegally imports an adapter
    const illegalSource = `
import { createSqliteSchemaAdapter } from '../../adapters/engines/sqlite/factory.js';
export function bad(): void { /* noop */ }
`;
    const specifiers = extractImportSpecifiers(illegalSource);
    const found = specifiers.some((s) => isForbiddenForCli(s));
    expect(found).toBe(true);
  });

  it('detects a direct better-sqlite3 import', () => {
    const illegalSource = `import Database from 'better-sqlite3';`;
    const specifiers = extractImportSpecifiers(illegalSource);
    const found = specifiers.some((s) => isForbiddenForCli(s));
    expect(found).toBe(true);
  });

  it('detects a mssql import', () => {
    const illegalSource = `import sql from 'mssql';`;
    const specifiers = extractImportSpecifiers(illegalSource);
    const found = specifiers.some((s) => isForbiddenForCli(s));
    expect(found).toBe(true);
  });

  it('does NOT flag src/index.ts imported as ../index.js', () => {
    const legalSource = `
import { runCli } from '../index.js';
import { join } from 'node:path';
import type { DbgraphConfig } from '../../index.js';
`;
    const specifiers = extractImportSpecifiers(legalSource);
    const found = specifiers.some((s) => isForbiddenForCli(s));
    expect(found).toBe(false);
  });

  it('does NOT flag @niklerk23/dbgraph barrel import', () => {
    const legalSource = `import { search } from '@niklerk23/dbgraph';`;
    const specifiers = extractImportSpecifiers(legalSource);
    const found = specifiers.some((s) => isForbiddenForCli(s));
    expect(found).toBe(false);
  });

  it('does NOT flag node:* builtin imports', () => {
    const legalSource = `import { readFileSync } from 'node:fs'; import { join } from 'node:path';`;
    const specifiers = extractImportSpecifiers(legalSource);
    const found = specifiers.some((s) => isForbiddenForCli(s));
    expect(found).toBe(false);
  });
});
