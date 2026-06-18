// US-031 write-verb security scanner — task 7.1.
// Scans src/adapters/engines/** TypeScript files for write verbs in SQL strings.
// Design §testing "US-031 write-verb scanner (mirrors boundaries.test.ts)".
//
// Rules:
//   - Scope: src/adapters/engines/**   (NOT src/adapters/storage/**)
//   - Tokenization: extract SQL from string/template literals only
//   - Strip: -- line comments and block comments BEFORE matching
//   - Match: write verbs on WORD BOUNDARIES
//   - False-positive guard: 'updated_at' MUST NOT trigger (boundary check)
//   - Negative control: injected write verb MUST fail the scan
//   - Exempt: src/adapters/storage/** (documented in storage/sqlite/factory.ts)

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// test/adapters/engines/ → two levels up is test/, three up is project root
const projectRoot = resolve(__dirname, '../../..');

// ─────────────────────────────────────────────────────────────────────────────
// File scanner (reuse pattern from boundaries.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  function walk(d: string): void {
    let entries: Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>;
    try {
      entries = readdirSync(d, { withFileTypes: true }) as Array<{
        isDirectory(): boolean;
        isFile(): boolean;
        name: string;
      }>;
    } catch {
      return; // directory may not exist yet (no engine adapters except sqlite)
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// SQL extraction and sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the content of all string literals and template literals
 * from a TypeScript source file.
 * Handles: single-quoted, double-quoted, and backtick strings.
 */
function extractStringLiterals(source: string): string[] {
  const literals: string[] = [];

  // Single-quoted strings (non-greedy, handles escapes naively)
  const singleRe = /'((?:[^'\\]|\\.)*)'/g;
  let m: RegExpExecArray | null;
  while ((m = singleRe.exec(source)) !== null) {
    if (m[1] !== undefined) literals.push(m[1]);
  }

  // Double-quoted strings
  const doubleRe = /"((?:[^"\\]|\\.)*)"/g;
  while ((m = doubleRe.exec(source)) !== null) {
    if (m[1] !== undefined) literals.push(m[1]);
  }

  // Template literals (backtick) — single level, no nesting
  const templateRe = /`((?:[^`\\]|\\.)*)`/g;
  while ((m = templateRe.exec(source)) !== null) {
    if (m[1] !== undefined) literals.push(m[1]);
  }

  return literals;
}

// Strips SQL comments from a string:
//   - Line comments:  -- ...
//   - Block comments: slash-star ... star-slash
function stripSqlComments(sql: string): string {
  // Strip block comments first
  let stripped = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Strip line comments
  stripped = stripped.replace(/--[^\n]*/g, ' ');
  return stripped;
}

// SQL indicator: a literal must contain at least one of these SQL keywords
// to be considered a SQL string worth scanning for write verbs.
// This prevents single-word TypeScript string values like 'DELETE' (trigger event enum)
// from being flagged when they are not SQL queries.
const SQL_INDICATOR_RE =
  /\b(SELECT|FROM|WHERE|PRAGMA|JOIN|HAVING|GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|WITH|UNION|TABLE|INTO|VALUES|SET\s+\w)\b/i;

/**
 * Returns true when a string literal looks like SQL content.
 * A string must contain at least one structural SQL keyword to qualify.
 * Single-word strings like 'DELETE' or 'INSERT' are TypeScript type literals,
 * not SQL queries — we do not flag them.
 */
function looksLikeSql(literal: string): boolean {
  return SQL_INDICATOR_RE.test(literal);
}

/**
 * Returns the write verbs found in a SQL-looking string after stripping SQL comments.
 * Empty array = no violations.
 * Only inspects literals that contain SQL structural keywords (looksLikeSql check).
 */
function findWriteVerbs(sqlLiteral: string): string[] {
  if (!looksLikeSql(sqlLiteral)) return [];
  const clean = stripSqlComments(sqlLiteral);
  const found: string[] = [];
  const re = /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|REPLACE)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    if (m[1] !== undefined) found.push(m[1].toUpperCase());
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe file for negative control (mirrors Phase-1 boundary probe pattern)
// ─────────────────────────────────────────────────────────────────────────────

const PROBE_PATH = join(
  projectRoot,
  'src',
  'adapters',
  'engines',
  '_write_verb_probe_DO_NOT_COMMIT.ts',
);

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

const enginesDir = join(projectRoot, 'src', 'adapters', 'engines');
const storageDir = join(projectRoot, 'src', 'adapters', 'storage');

describe('US-031 write-verb scanner: src/adapters/engines/**', () => {
  const engineFiles = collectTsFiles(enginesDir);

  it('finds at least one engine TypeScript file to scan', () => {
    expect(engineFiles.length).toBeGreaterThan(0);
  });

  // F6.1: explicit assertion that the strategies/ directory is covered by the scanner.
  // Design §"scanner covers strategies/": the existing engines/** glob recurses into
  // strategies/ automatically — this assertion pins that behaviour as a regression guard.
  it('strategies/ directory files are included in the scan (F6.1)', () => {
    const strategiesFiles = engineFiles.filter((f) => f.includes('strategies'));
    expect(strategiesFiles.length).toBeGreaterThan(0);
  });

  it('no engine file contains write verbs in SQL string literals', () => {
    const violations: string[] = [];

    for (const filePath of engineFiles) {
      const source = readFileSync(filePath, 'utf-8');
      const literals = extractStringLiterals(source);

      for (const literal of literals) {
        const verbs = findWriteVerbs(literal);
        if (verbs.length > 0) {
          violations.push(
            `${filePath}\n  → SQL literal contains write verbs [${verbs.join(', ')}]: ${JSON.stringify(literal.slice(0, 120))}`,
          );
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Write-verb violations found in engine adapter SQL:\n${violations.join('\n')}\n\n` +
          'Engine adapters MUST only contain read-only SQL. ' +
          'Write operations belong in src/adapters/storage/** (ADR-005).',
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('"updated_at" column name does NOT false-positive as a write verb (word boundary check)', () => {
    // "updated_at" contains "update" but is not a word-boundary match.
    // Even in a SQL context (e.g. SELECT updated_at FROM t), it must not be flagged.
    const sqlWithUpdatedAt = 'SELECT id, updated_at FROM employees WHERE active = 1';
    const verbs = findWriteVerbs(sqlWithUpdatedAt);
    expect(verbs).toHaveLength(0);
  });

  it('verb inside a SQL comment is NOT flagged (comment stripping)', () => {
    const commentedVerb = '-- INSERT INTO foo VALUES (1)';
    const verbs = findWriteVerbs(commentedVerb);
    expect(verbs).toHaveLength(0);
  });

  it('verb inside a block comment is NOT flagged (comment stripping)', () => {
    const blockCommentVerb = '/* DELETE FROM foo */ SELECT 1';
    const verbs = findWriteVerbs(blockCommentVerb);
    expect(verbs).toHaveLength(0);
  });
});

describe('US-031 negative control: injected write verb MUST fail the scan', () => {
  it('scanner detects injected INSERT in a probe file and the probe itself FAILS the scan', () => {
    // Write a probe file with a SQL literal containing a write verb
    const probeContent = `
// PROBE FILE — written and deleted by security-scan.test.ts
// Simulates a rogue write verb to prove the scanner bites.
export const EVIL_QUERY = "INSERT INTO forbidden_table VALUES (1)";
`;
    writeFileSync(PROBE_PATH, probeContent, 'utf-8');

    const probeViolations: string[] = [];
    try {
      const source = readFileSync(PROBE_PATH, 'utf-8');
      const literals = extractStringLiterals(source);
      for (const literal of literals) {
        const verbs = findWriteVerbs(literal);
        if (verbs.length > 0) {
          probeViolations.push(`found: [${verbs.join(', ')}]`);
        }
      }
    } finally {
      // Always clean up the probe file
      try { unlinkSync(PROBE_PATH); } catch { /* Windows may delay */ }
    }

    // The scanner MUST have flagged at least one violation
    expect(probeViolations.length).toBeGreaterThan(0);
  });

  it('scanner detects UPDATE in a probe file', () => {
    const probeContent = `
export const EVIL_UPDATE = 'UPDATE employees SET salary = 0 WHERE 1=1';
`;
    writeFileSync(PROBE_PATH, probeContent, 'utf-8');

    let found = false;
    try {
      const source = readFileSync(PROBE_PATH, 'utf-8');
      const literals = extractStringLiterals(source);
      for (const literal of literals) {
        const verbs = findWriteVerbs(literal);
        if (verbs.includes('UPDATE')) found = true;
      }
    } finally {
      try { unlinkSync(PROBE_PATH); } catch { /* Windows */ }
    }

    expect(found).toBe(true);
  });
});

describe('US-031 storage exemption documented', () => {
  it('src/adapters/storage is explicitly exempt (not scanned)', () => {
    // Confirm storage dir exists and contains files that WOULD fail the scan
    // (but are not scanned because storage writes by design — ADR-005)
    const storageFiles = collectTsFiles(storageDir);
    expect(storageFiles.length).toBeGreaterThan(0);

    // The storage adapter files are NOT in engineFiles
    const storageInEngines = storageFiles.filter((f) => f.startsWith(enginesDir));
    expect(storageInEngines).toHaveLength(0);
  });
});
