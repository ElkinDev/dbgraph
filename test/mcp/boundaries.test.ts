/**
 * MCP hexagonal boundary enforcement test — task 2.3 (phase-5-mcp-server).
 * Design Decision 10: any src/mcp/** file that imports src/adapters/** or
 * src/cli/** or a forbidden DB driver MUST FAIL this test.
 *
 * Legal imports for src/mcp/**:
 *   - The public barrel (src/index.ts) via ../../index.js
 *   - @modelcontextprotocol/sdk
 *   - node:* builtins
 *
 * Forbidden:
 *   - Any specifier containing /adapters/
 *   - Any specifier containing /cli/
 *   - Direct DB driver packages: better-sqlite3, mssql, pg, mysql2, mongodb
 *
 * Red-green proof: the test includes a "planted import" describe block that
 * dynamically builds a probe source string containing a forbidden adapter import
 * and asserts that the scanner detects it. This proves the test WOULD have failed
 * before the boundary was enforced.
 *
 * Note: when src/mcp/ does not exist yet, collectTsFiles returns [] and the
 * main boundary test passes (empty scan). The negative-control tests still run
 * and confirm the scanner works correctly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// File scanner (reuses pattern from test/cli/boundaries.test.ts)
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
  try {
    walk(dir);
  } catch {
    // directory does not exist yet — empty scan is intentional
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
// Boundary rules for src/mcp/**
// ─────────────────────────────────────────────────────────────────────────────

/** DB drivers that mcp must never reference directly. */
const FORBIDDEN_DRIVERS = [
  'better-sqlite3',
  'mssql',
  'pg',
  'mysql2',
  'mongodb',
];

/**
 * Returns true when a specifier violates the MCP boundary (ADR-004).
 * The MCP MUST import ONLY:
 *   - src/index.ts via the barrel (../../index.js, ../index.js, etc.)
 *   - @modelcontextprotocol/sdk
 *   - node:* builtins
 *
 * Forbidden:
 *   - Any relative path that traverses into /adapters/
 *   - Any relative path that traverses into /cli/
 *   - Direct DB driver packages
 */
function isForbiddenForMcp(specifier: string): boolean {
  if (specifier.includes('/adapters/')) return true;
  if (specifier.includes('/cli/')) return true;
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
// This file is at test/mcp/boundaries.test.ts — two levels up is the project root
const projectRoot = resolve(__dirname, '../..');

const mcpSrcDir = join(projectRoot, 'src', 'mcp');

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('hexagonal boundary: src/mcp must not import src/adapters, src/cli, or drivers', () => {
  const mcpFiles = collectTsFiles(mcpSrcDir);

  it('src/mcp directory scan runs without error (may be empty before scaffold)', () => {
    // collectTsFiles returns [] when the directory does not exist yet
    expect(Array.isArray(mcpFiles)).toBe(true);
  });

  it('no mcp file imports from src/adapters/**, src/cli/**, or DB drivers', () => {
    const violations: string[] = [];

    for (const filePath of mcpFiles) {
      const source = readFileSync(filePath, 'utf-8');
      const specifiers = extractImportSpecifiers(source);

      for (const spec of specifiers) {
        if (isForbiddenForMcp(spec)) {
          violations.push(`${filePath}\n  → imports "${spec}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `MCP boundary violations found:\n${violations.join('\n')}\n\n` +
          'Fix: src/mcp/** must import ONLY from the public barrel (src/index.ts via ../../index.js), ' +
          '@modelcontextprotocol/sdk, or node:* builtins (ADR-004, Design Decision 10).',
      );
    }

    expect(violations).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Red-green proof: scanner bites on planted forbidden imports
// ─────────────────────────────────────────────────────────────────────────────

describe('MCP boundary scanner: negative control (proves the test would have failed)', () => {
  it('detects a relative import containing /adapters/', () => {
    const illegalSource = `
import { createSqliteSchemaAdapter } from '../../adapters/engines/sqlite/factory.js';
export function bad(): void { /* noop */ }
`;
    const specifiers = extractImportSpecifiers(illegalSource);
    const found = specifiers.some((s) => isForbiddenForMcp(s));
    expect(found).toBe(true);
  });

  it('detects a relative import containing /cli/', () => {
    const illegalSource = `
import { openConnections } from '../../cli/config/open-connections.js';
export function bad(): void { /* noop */ }
`;
    const specifiers = extractImportSpecifiers(illegalSource);
    const found = specifiers.some((s) => isForbiddenForMcp(s));
    expect(found).toBe(true);
  });

  it('detects a direct better-sqlite3 import', () => {
    const illegalSource = `import Database from 'better-sqlite3';`;
    const specifiers = extractImportSpecifiers(illegalSource);
    const found = specifiers.some((s) => isForbiddenForMcp(s));
    expect(found).toBe(true);
  });

  it('detects a mssql import', () => {
    const illegalSource = `import sql from 'mssql';`;
    const specifiers = extractImportSpecifiers(illegalSource);
    const found = specifiers.some((s) => isForbiddenForMcp(s));
    expect(found).toBe(true);
  });

  it('does NOT flag the barrel import (../../index.js)', () => {
    const legalSource = `
import { openConnections } from '../../index.js';
import { getNeighbors } from '../../index.js';
`;
    const specifiers = extractImportSpecifiers(legalSource);
    const found = specifiers.some((s) => isForbiddenForMcp(s));
    expect(found).toBe(false);
  });

  it('does NOT flag @modelcontextprotocol/sdk imports', () => {
    const legalSource = `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
`;
    const specifiers = extractImportSpecifiers(legalSource);
    const found = specifiers.some((s) => isForbiddenForMcp(s));
    expect(found).toBe(false);
  });

  it('does NOT flag node:* builtin imports', () => {
    const legalSource = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
`;
    const specifiers = extractImportSpecifiers(legalSource);
    const found = specifiers.some((s) => isForbiddenForMcp(s));
    expect(found).toBe(false);
  });
});
