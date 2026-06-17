/**
 * Repository leak-scanner gate.
 *
 * Fails the build if any tracked text file contains:
 *   1. Inline URL credentials of the form `scheme://user:pass@host` — a hard
 *      secret leak that must NEVER be committed.
 *   2. Any project-specific sensitive identifier listed in a denylist. The
 *      denylist NEVER lives in the repository (committing it would defeat the
 *      purpose); it is supplied out-of-band via:
 *        - the `LEAKSCAN_DENYLIST` env var (comma-separated), set as a CI secret, or
 *        - a git-ignored `.leakscan-denylist.local` file (one term per line, `#` comments).
 *
 * Rationale: secrets are referenced only as `${env:VAR}` (dbgraph-security), and
 * internal infrastructure names / codenames must never reach a public repo. This
 * is the mechanism that keeps that true on every commit, not just once.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname substitute for ESM (handles Windows drive letters correctly).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// This file is at test/security/no-secret-leak.test.ts — two levels up is the project root.
const projectRoot = resolve(__dirname, '../..');

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.dbgraph']);
// Large generated lockfile carries npm-registry URLs (no embedded credentials) — skip for speed.
const EXCLUDE_FILES = new Set(['package-lock.json']);
const TEXT_EXT = /\.(ts|tsx|js|jsx|cjs|mjs|json|md|ya?ml|sql|txt|sh|toml)$/i;

// scheme://user:pass@host  — an embedded credential in a connection URL.
const INLINE_CREDENTIAL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;

/** Recursively collect scannable text files, skipping excluded dirs/files and this test itself. */
function collectTextFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) collectTextFiles(full, acc);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      if (full === __filename) continue; // never scan the scanner
      if (TEXT_EXT.test(entry.name)) acc.push(full);
    }
  }
  return acc;
}

/** Denylist terms from env or a git-ignored local file; empty when none configured. */
function denylistTerms(): string[] {
  const fromEnv = process.env.LEAKSCAN_DENYLIST;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
  const localFile = join(projectRoot, '.leakscan-denylist.local');
  if (existsSync(localFile)) {
    return readFileSync(localFile, 'utf-8')
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !t.startsWith('#'));
  }
  return [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const files = collectTextFiles(projectRoot);

describe('repository leak-scanner: no secrets or sensitive identifiers committed', () => {
  it('finds tracked text files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no inline URL credentials (scheme://user:pass@host)', () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (INLINE_CREDENTIAL.test(line)) hits.push(`${relative(projectRoot, file)}:${i + 1}`);
      });
    }
    if (hits.length > 0) {
      expect.fail(
        `Inline URL credentials found:\n${hits.join('\n')}\n\n` +
          'Fix: never commit credentials. Reference secrets as ${env:VAR} only (dbgraph-security).',
      );
    }
    expect(hits).toHaveLength(0);
  });

  it('contains no denylisted sensitive identifiers (LEAKSCAN_DENYLIST / .leakscan-denylist.local)', () => {
    const terms = denylistTerms();
    if (terms.length === 0) {
      // No denylist configured in this environment — nothing project-specific to enforce here.
      // (CI enforces this via the LEAKSCAN_DENYLIST secret.)
      expect(terms).toEqual([]);
      return;
    }
    const patterns = terms.map((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i'));
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (patterns.some((p) => p.test(line))) hits.push(`${relative(projectRoot, file)}:${i + 1}`);
      });
    }
    if (hits.length > 0) {
      expect.fail(
        `Denylisted sensitive identifiers found:\n${hits.join('\n')}\n\n` +
          'Fix: internal infrastructure names / codenames must never reach the repository.',
      );
    }
    expect(hits).toHaveLength(0);
  });
});
