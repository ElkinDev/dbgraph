/**
 * release.yml TRIGGER-GUARD test — the load-bearing CI-safety contract (spec R4, design D10/Q7).
 *
 * CI quota is EXHAUSTED: release.yml must be IMPOSSIBLE to fire by accident. This test PARSES
 * the workflow's `on:` block as DATA (not a regex grep) and asserts the ONLY triggers are a
 * tag `push` and `workflow_dispatch` — NO `pull_request`, NO branch `push`. A branch-push or
 * PR trigger sneaking in would let a merge burn the quota; this test is the tripwire.
 *
 * "Parse the YAML as data": rather than add a YAML library (ADR-007 — this repo favors bounded
 * in-house micro-parsers over general libraries, cf. US-038's Codex TOML micro-writer), a small
 * dependency-free block-YAML parser scoped to the `on:` block turns it into a nested object the
 * assertions read structurally. YAML 1.2 (which this parser follows) treats `on` as the string
 * key `"on"` — no YAML-1.1 "Norway problem" boolean coercion.
 *
 * Also asserts (R4 second scenario) the matrix covers windows/linux/macos and that a
 * SHA256SUMS-producing step and a build-provenance attestation step exist. These are step-level
 * text assertions on the raw workflow (the DATA contract the constraint pins is the trigger set).
 *
 * TDD: RED (.github/workflows/release.yml does not exist yet) → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const workflowPath = join(repoRoot, '.github', 'workflows', 'release.yml');
const workflowText = readFileSync(workflowPath, 'utf-8');

// ── Bounded block-YAML parser (dependency-free, scoped to the `on:` trigger block) ──────────

type YamlValue = string | null | YamlValue[] | { [key: string]: YamlValue };

/** Leading-space count — the block structure is indentation-defined. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A meaningful line carries structure (not blank, not a `#` comment). */
function isMeaningful(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && !t.startsWith('#');
}

/** Strips a single layer of matching single/double quotes from a scalar. */
function stripScalar(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return t.slice(1, -1);
    }
  }
  return t;
}

/**
 * Parses a set of sibling block lines (a mapping, a scalar-sequence, or empty) into a value.
 * Handles exactly what the workflow `on:` block uses: nested mappings, `key: value` scalars,
 * empty mapping values (`key:`), and block sequences of scalars (`- item`).
 */
function parseBlock(lines: readonly string[]): YamlValue {
  const meaningful = lines.filter(isMeaningful);
  const first = meaningful[0];
  if (first === undefined) return null;

  const baseIndent = Math.min(...meaningful.map(indentOf));

  // Block sequence of scalars (e.g. the `tags:` list).
  if (first.trim().startsWith('- ')) {
    return meaningful
      .filter((l) => indentOf(l) === baseIndent && l.trim().startsWith('- '))
      .map((l) => stripScalar(l.trim().slice(2)));
  }

  // Block mapping.
  const map: Record<string, YamlValue> = {};
  for (let i = 0; i < meaningful.length; ) {
    const line = meaningful[i];
    if (line === undefined || indentOf(line) !== baseIndent) {
      i += 1;
      continue;
    }
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    const key = colon === -1 ? trimmed : trimmed.slice(0, colon).trim();
    const inline = colon === -1 ? '' : trimmed.slice(colon + 1).trim();

    // Gather deeper-indented children up to the next sibling at baseIndent.
    const children: string[] = [];
    let j = i + 1;
    for (; j < meaningful.length; j += 1) {
      const child = meaningful[j];
      if (child === undefined || indentOf(child) <= baseIndent) break;
      children.push(child);
    }

    if (children.length > 0) {
      map[key] = parseBlock(children);
    } else {
      map[key] = inline === '' ? null : stripScalar(inline);
    }
    i = j;
  }
  return map;
}

/** Extracts the top-level `on:` block and parses it into structured data. */
function parseOnBlock(text: string): Record<string, YamlValue> {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => indentOf(l) === 0 && /^on:\s*$/.test(l));
  expect(startIdx, 'workflow must declare a top-level `on:` block').toBeGreaterThanOrEqual(0);

  const block: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    if (isMeaningful(line) && indentOf(line) === 0) break; // next top-level key ends the block
    block.push(line);
  }
  const parsed = parseBlock(block);
  expect(parsed !== null && !Array.isArray(parsed) && typeof parsed === 'object').toBe(true);
  return parsed as Record<string, YamlValue>;
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────

describe('release.yml — trigger guard (spec R4, design D10)', () => {
  const on = parseOnBlock(workflowText);

  it('the ONLY triggers are tag-push and workflow_dispatch', () => {
    expect(Object.keys(on).sort()).toStrictEqual(['push', 'workflow_dispatch']);
  });

  it('push is a TAG push pinned to v*.*.* — NOT a branch push', () => {
    const push = on['push'];
    expect(push !== null && typeof push === 'object' && !Array.isArray(push)).toBe(true);
    const pushMap = push as Record<string, YamlValue>;
    expect(pushMap['tags']).toStrictEqual(['v*.*.*']);
    // A branch push would burn CI quota on every merge — it must be ABSENT.
    expect('branches' in pushMap).toBe(false);
  });

  it('has NO pull_request trigger (a PR must never start the release)', () => {
    expect('pull_request' in on).toBe(false);
  });

  it('workflow_dispatch is present (manual-only fallback)', () => {
    expect('workflow_dispatch' in on).toBe(true);
  });

  it('has NO schedule trigger (never fires on a timer)', () => {
    expect('schedule' in on).toBe(false);
  });
});

describe('release.yml — matrix, SHA256SUMS and provenance (spec R4 second scenario)', () => {
  it('the build matrix covers windows, linux and macos (macOS dormant — Q7)', () => {
    expect(workflowText).toContain('windows-latest');
    expect(workflowText).toContain('ubuntu-latest');
    expect(workflowText).toContain('macos-latest');
  });

  it('a step produces a SHA256SUMS file over the artifacts', () => {
    expect(workflowText).toContain('SHA256SUMS');
  });

  it('a build-provenance attestation step is present', () => {
    expect(workflowText).toContain('actions/attest-build-provenance');
  });

  it('grants the id-token and attestations write permissions provenance needs', () => {
    expect(workflowText).toContain('id-token: write');
    expect(workflowText).toContain('attestations: write');
  });
});
