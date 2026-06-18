/**
 * Hexagonal boundary enforcement test — task 7.2, design §8.
 * Scans src/core/**\/*.ts imports and fails if any import violates the
 * hexagonal boundary (ADR-004):
 *   - src/core files MUST NOT import from src/adapters, src/mcp, src/cli,
 *     or any DB driver (better-sqlite3, mssql, pg, mysql2, mongodb).
 *   - src/adapters/storage/sqlite files MUST NOT import from src/mcp or src/cli.
 *
 * Design §8: uses a dependency-free vitest scan (no eslint plugin — ADR-007).
 * Pattern: simple regex over import/from specifiers + dynamic import() calls.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// File scanner
// ─────────────────────────────────────────────────────────────────────────────

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  function walk(d: string): void {
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
  walk(dir);
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
// Boundary rules
// ─────────────────────────────────────────────────────────────────────────────

/** DB drivers that core must never reference. */
const FORBIDDEN_DRIVERS = [
  'better-sqlite3',
  'mssql',
  'pg',
  'mysql2',
  'mongodb',
];

/**
 * Returns true if the specifier resolves to a forbidden layer when
 * evaluated from inside src/core/.
 */
function isForbiddenForCore(specifier: string): boolean {
  // Relative imports into forbidden directories
  if (
    specifier.includes('/adapters/') ||
    specifier.includes('/mcp/') ||
    specifier.includes('/cli/')
  ) {
    return true;
  }
  // Package-level drivers
  if (FORBIDDEN_DRIVERS.some((d) => specifier === d || specifier.startsWith(`${d}/`))) {
    return true;
  }
  return false;
}

/**
 * Returns true if the specifier resolves to a forbidden layer when
 * evaluated from inside src/adapters/storage/sqlite/.
 */
function isForbiddenForAdapter(specifier: string): boolean {
  if (specifier.includes('/mcp/') || specifier.includes('/cli/')) {
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project root (relative to this test file's location)
// ─────────────────────────────────────────────────────────────────────────────

// __dirname substitute for ESM (fileURLToPath handles Windows drive letters correctly)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// This file is at test/core/boundaries.test.ts — two levels up is the project root
const projectRoot = resolve(__dirname, '../..');

const coreSrcDir = join(projectRoot, 'src', 'core');
const adapterSrcDir = join(projectRoot, 'src', 'adapters', 'storage', 'sqlite');
const infraSrcDir = join(projectRoot, 'src', 'infra');

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('hexagonal boundary: src/core must not import adapters/drivers/mcp/cli', () => {
  const coreFiles = collectTsFiles(coreSrcDir);

  it('finds at least one core TypeScript file to scan', () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  it('no core file imports from src/adapters, src/mcp, src/cli, or DB drivers', () => {
    const violations: string[] = [];

    for (const filePath of coreFiles) {
      const source = readFileSync(filePath, 'utf-8');
      const specifiers = extractImportSpecifiers(source);

      for (const spec of specifiers) {
        if (isForbiddenForCore(spec)) {
          violations.push(`${filePath}\n  → imports "${spec}"`);
        }
      }
    }

    if (violations.length > 0) {
      // Fail with a useful message listing every violation
      expect.fail(
        `Core boundary violations found:\n${violations.join('\n')}\n\n` +
          'Fix: core must only import from core sub-modules, node:*, or npm packages ' +
          'that are not DB drivers (ADR-004/ADR-007).',
      );
    }

    expect(violations).toHaveLength(0);
  });
});

describe('hexagonal boundary: src/adapters/storage/sqlite must not import mcp/cli', () => {
  const adapterFiles = collectTsFiles(adapterSrcDir);

  it('finds adapter TypeScript files to scan', () => {
    expect(adapterFiles.length).toBeGreaterThan(0);
  });

  it('no adapter file imports from src/mcp or src/cli', () => {
    const violations: string[] = [];

    for (const filePath of adapterFiles) {
      const source = readFileSync(filePath, 'utf-8');
      const specifiers = extractImportSpecifiers(source);

      for (const spec of specifiers) {
        if (isForbiddenForAdapter(spec)) {
          violations.push(`${filePath}\n  → imports "${spec}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Adapter boundary violations found:\n${violations.join('\n')}\n\n` +
          'Fix: adapters must not import from mcp or cli layers (ADR-004).',
      );
    }

    expect(violations).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.3 — schema-adapter port is driver-free (US-026)
// ─────────────────────────────────────────────────────────────────────────────

describe('hexagonal boundary: schema-adapter port is driver-free', () => {
  const schemaAdapterPath = join(projectRoot, 'src', 'core', 'ports', 'schema-adapter.ts');

  it('schema-adapter.ts file exists in core ports', () => {
    // If the file doesn't exist, readFileSync below will throw and the test fails naturally.
    const source = readFileSync(schemaAdapterPath, 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('schema-adapter.ts imports no driver, adapter, mcp, or cli symbol', () => {
    const source = readFileSync(schemaAdapterPath, 'utf-8');
    const specifiers = extractImportSpecifiers(source);

    const violations: string[] = [];
    for (const spec of specifiers) {
      if (isForbiddenForCore(spec)) {
        violations.push(`schema-adapter.ts imports "${spec}"`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `SchemaAdapter port boundary violations:\n${violations.join('\n')}\n\n` +
          'Fix: the port MUST be expressible without any driver, adapter, mcp, or cli import (ADR-004).',
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('schema-adapter.ts is implementable by a test double with no DB connection', () => {
    // Prove it compiles and can be implemented by an in-memory stub.
    // This test imports the TYPE only — if the import resolves, the port is driver-free
    // by TypeScript's module graph (the boundary test above already covers runtime imports).
    // We assert the shape of the interface by constructing a minimal inline test double.
    type SA = import('../../src/core/ports/schema-adapter.js').SchemaAdapter;

    const testDouble: SA = {
      dialect: 'test',
      capabilities: {
        engine: 'test',
        supported: new Set(),
        defaultLevels: {
          tables: 'off',
          columns: 'off',
          constraints: 'off',
          indexes: 'off',
          views: 'off',
          procedures: 'off',
          functions: 'off',
          triggers: 'off',
          sequences: 'off',
          collections: 'off',
          fields: 'off',
          statistics: 'off',
          sampling: 'off',
        },
        supportsBodies: false,
        supportsDependencyHints: false,
      },
      extract: () => Promise.resolve({ engine: 'test', schemas: [], objects: [] }),
      fingerprint: () => Promise.resolve('abc'),
      close: () => Promise.resolve(),
    };

    expect(testDouble.dialect).toBe('test');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Infra layer boundary (added in phase-5-mcp-server Batch B fix)
// ─────────────────────────────────────────────────────────────────────────────
//
// ADR-004: src/infra/** is the composition seam. It MAY import adapter/store
// factories and core, but MUST NOT import src/cli/** or src/mcp/**.
// This rule enforces that open-connections.ts (and any future infra module)
// cannot transitively pull cli or mcp into the MCP adapter.

/**
 * Returns true if the specifier violates the infra boundary.
 * Infra MUST NOT import from src/cli/** or src/mcp/**.
 */
function isForbiddenForInfra(specifier: string): boolean {
  if (specifier.includes('/cli/')) return true;
  if (specifier.includes('/mcp/')) return true;
  return false;
}

describe('hexagonal boundary: src/infra must not import src/cli or src/mcp', () => {
  const infraFiles = collectTsFiles(infraSrcDir);

  it('finds at least one infra TypeScript file to scan', () => {
    expect(infraFiles.length).toBeGreaterThan(0);
  });

  it('no infra file imports from src/cli/** or src/mcp/**', () => {
    const violations: string[] = [];

    for (const filePath of infraFiles) {
      const source = readFileSync(filePath, 'utf-8');
      const specifiers = extractImportSpecifiers(source);

      for (const spec of specifiers) {
        if (isForbiddenForInfra(spec)) {
          violations.push(`${filePath}\n  → imports "${spec}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Infra boundary violations found:\n${violations.join('\n')}\n\n` +
          'Fix: src/infra/** must not import from src/cli/** or src/mcp/**. ' +
          'Move shared config types to src/infra/config/ instead (ADR-004).',
      );
    }

    expect(violations).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F6.2 — connectivity-strategy port is driver-free (US-031, ADR-004)
// ─────────────────────────────────────────────────────────────────────────────
//
// The ConnectivityStrategy port lives in src/core/ports/ and MUST NOT import
// any driver (mssql, better-sqlite3, pg, mysql2), external tool
// (node:child_process), adapter layer (src/adapters/**), mcp, or cli symbol.
// This is an EXPLICIT regression guard pinning the F6.2 boundary hygiene task.
//
// Note: the general core-boundary scan above already covers this file by
// inclusion (it walks all of src/core/). This focused test pins it explicitly
// so a future "move the port" refactor triggers a clear, named failure.

describe('hexagonal boundary: connectivity-strategy port is driver-free (F6.2)', () => {
  const strategyPortPath = join(projectRoot, 'src', 'core', 'ports', 'connectivity-strategy.ts');

  it('connectivity-strategy.ts file exists in core ports', () => {
    const source = readFileSync(strategyPortPath, 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('connectivity-strategy.ts imports no driver, adapter, mcp, cli, or node:child_process', () => {
    const source = readFileSync(strategyPortPath, 'utf-8');
    const specifiers = extractImportSpecifiers(source);

    const violations: string[] = [];
    for (const spec of specifiers) {
      if (isForbiddenForCore(spec)) {
        violations.push(`connectivity-strategy.ts imports "${spec}"`);
      }
      // Extra guard: no node:child_process import allowed in the port
      if (spec === 'node:child_process' || spec.startsWith('node:child_process/')) {
        violations.push(`connectivity-strategy.ts imports "${spec}" (child_process forbidden in core)`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `ConnectivityStrategy port boundary violations:\n${violations.join('\n')}\n\n` +
          'Fix: the port MUST be expressible with only core model types + Logger port. ' +
          'No driver, adapter, child_process, mcp, or cli import is permitted (ADR-004).',
      );
    }

    expect(violations).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F6.2 — exhaustion.ts CLI formatter imports only the public barrel (ADR-004)
// ─────────────────────────────────────────────────────────────────────────────
//
// src/cli/format/exhaustion.ts is a CLI-layer pure formatter.
// It MUST NOT import from src/adapters/** (would pull adapter logic into CLI).
// Its only permitted import is the project's public barrel (src/index.ts or
// relative paths resolving to src/core/**).
//
// This guards the deviation documented in the Batch E apply-progress:
// DUMP_DIR / DUMP_FILE are inlined as constants instead of importing from
// dump-emitter.ts (which lives in adapters) — the comment in the source
// file explains the coupling; this test pins it so the duplication is
// a conscious, enforced choice.

describe('hexagonal boundary: exhaustion.ts imports only the public barrel (F6.2)', () => {
  const exhaustionPath = join(projectRoot, 'src', 'cli', 'format', 'exhaustion.ts');

  it('exhaustion.ts file exists in src/cli/format/', () => {
    const source = readFileSync(exhaustionPath, 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('exhaustion.ts does not import from src/adapters/**', () => {
    const source = readFileSync(exhaustionPath, 'utf-8');
    const specifiers = extractImportSpecifiers(source);

    const violations: string[] = [];
    for (const spec of specifiers) {
      if (spec.includes('/adapters/')) {
        violations.push(`exhaustion.ts imports "${spec}" — CLI layer must not import adapters (ADR-004)`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `exhaustion.ts boundary violations:\n${violations.join('\n')}\n\n` +
          'Fix: the CLI formatter must not import from src/adapters/**. ' +
          'Duplicate any needed constants inline and add a comment explaining the coupling.',
      );
    }

    expect(violations).toHaveLength(0);
  });
});
