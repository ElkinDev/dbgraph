/**
 * Tasks 3.1–3.3 + 3.5 — RED→GREEN: the `viz` CLI command.
 *
 * 3.1 handleViz flag validation — the Q5 ConfigError matrix (exit 2), each contradictory
 *     combo → ConfigError + exact actionable message (parseVizOptions, pure).
 * 3.2 happy path — buildVizExport opens nothing, bulk-reads the store, string-concats ONE
 *     self-contained HTML (`#dbgraph-data` block + inlined `<style>`/`<script>`, vendored
 *     ISC d3 attribution); handleViz writes it and prints a one-line confirmation + exit 0.
 * 3.3 `--mermaid` path — emits the B1 mermaid golden text, zero JS/deps, exit 0.
 * 3.5 vendored provenance — PROVENANCE records a non-empty version + 64-hex sha256 and the
 *     vendored files carry the license header (ISC, corrected from the design's MIT).
 *
 * Spec `cli-config`: "viz writes a self-contained HTML and exits 0", "--mermaid emits the ER
 * diagram", "invalid flag value or combination exits 2 with an actionable message".
 * L-009: toStrictEqual / toBe, no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { parseVizOptions, buildVizExport, handleViz } from '../../../src/cli/commands/viz.js';
import { ConfigError } from '../../../src/index.js';
import { openFixtureStore, type FixtureStore } from '../../mcp/fixture.js';
import { materializeTorture, type MaterializedDb } from '../../fixtures/sqlite/materialize.js';
import { buildConfig, writeConfig } from '../../../src/cli/config/build-config.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const mermaidGoldenPath = join(repoRoot, 'test', 'core', 'viz', 'golden', 'mermaid-er.mmd');
const vendorDir = join(repoRoot, 'src', 'cli', 'commands', 'viz', 'assets', 'vendor');

// ─────────────────────────────────────────────────────────────────────────────
// 3.1 — parseVizOptions: the Q5 invalid-combination matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('parseVizOptions — Q5 ConfigError matrix (task 3.1)', () => {
  it('--mermaid + --full → ConfigError naming the viewer flag', () => {
    expect(() => parseVizOptions({ mermaid: true, full: true })).toThrow(ConfigError);
    try {
      parseVizOptions({ mermaid: true, full: true });
    } catch (e) {
      expect((e as Error).message).toBe(
        '--mermaid emits a pure ER diagram and cannot be combined with viewer flag --full (drop --full or --mermaid).',
      );
    }
  });

  it('--mermaid + --schema → ConfigError naming --schema', () => {
    try {
      parseVizOptions({ mermaid: true, schema: 'main' });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toBe(
        '--mermaid emits a pure ER diagram and cannot be combined with viewer flag --schema (drop --schema or --mermaid).',
      );
    }
  });

  it('--mermaid + --min-degree → ConfigError naming --min-degree', () => {
    try {
      parseVizOptions({ mermaid: true, 'min-degree': '2' });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect((e as Error).message).toBe(
        '--mermaid emits a pure ER diagram and cannot be combined with viewer flag --min-degree (drop --min-degree or --mermaid).',
      );
    }
  });

  it('--full + --kinds → ConfigError', () => {
    try {
      parseVizOptions({ full: true, kinds: 'table' });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toBe(
        '--full renders every kind and cannot be combined with the --kinds allowlist.',
      );
    }
  });

  it('--full + --columns → ConfigError ("implied by --full")', () => {
    try {
      parseVizOptions({ full: true, columns: true });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect((e as Error).message).toBe('--columns is implied by --full; pass one, not both.');
    }
  });

  it('--min-degree non-integer → ConfigError echoing the bad value', () => {
    try {
      parseVizOptions({ 'min-degree': 'abc' });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect((e as Error).message).toBe('--min-degree must be a non-negative integer, got "abc".');
    }
  });

  it('--min-degree negative → ConfigError (leading minus is not a non-negative integer)', () => {
    try {
      parseVizOptions({ 'min-degree': '-3' });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect((e as Error).message).toBe('--min-degree must be a non-negative integer, got "-3".');
    }
  });

  it('--kinds unknown kind → ConfigError listing the valid kinds', () => {
    try {
      parseVizOptions({ kinds: 'table,wombat' });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect((e as Error).message).toContain('--kinds contains unknown kind "wombat"');
      expect((e as Error).message).toContain('table');
    }
  });

  it('--schema empty (=) → ConfigError', () => {
    try {
      parseVizOptions({ schema: '' });
      expect.fail('expected ConfigError');
    } catch (e) {
      expect((e as Error).message).toBe('--schema requires a non-empty schema name.');
    }
  });

  it('valid HTML invocation → mermaid false, default out, parsed options', () => {
    const inv = parseVizOptions({ schema: 'main', 'min-degree': '2', columns: true });
    expect(inv).toStrictEqual({
      mermaid: false,
      out: null,
      options: { full: false, columns: true, schema: 'main', minDegree: 2 },
    });
  });

  it('valid --mermaid + --out → mermaid true, out path, no viewer options', () => {
    const inv = parseVizOptions({ mermaid: true, out: 'er.mmd' });
    expect(inv).toStrictEqual({ mermaid: true, out: 'er.mmd', options: { full: false } });
  });

  it('--kinds is parsed into a trimmed allowlist of known kinds', () => {
    const inv = parseVizOptions({ kinds: 'table, view' });
    expect(inv.options.kinds).toStrictEqual(['table', 'view']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.2 / 3.3 — buildVizExport over the torture fixture
// ─────────────────────────────────────────────────────────────────────────────

describe('buildVizExport — self-contained HTML + mermaid (tasks 3.2, 3.3)', () => {
  let fx: FixtureStore;
  beforeAll(async () => { fx = await openFixtureStore(); });
  afterAll(async () => { await fx.cleanup(); });

  it('HTML: one self-contained document with the embedded data block + inlined assets', async () => {
    const out = await buildVizExport(fx.store, parseVizOptions({}));
    expect(out.mermaid).toBe(false);
    expect(out.outPath).toBe('graph.html');
    expect(out.content.startsWith('<!doctype html>')).toBe(true);
    // embedded data block (application/json script, not executable)
    expect(out.content).toContain('<script id="dbgraph-data" type="application/json">');
    // inlined style + client script (no external references)
    expect(out.content).toContain('<style>');
    // vendored ISC d3 attribution is reproduced in the output
    expect(out.content).toContain('Copyright 2010-2021 Mike Bostock');
    expect(out.content).toContain('d3.forceSimulation');
  });

  it('HTML: the embedded data block parses to a graph with nodes/edges/communities', async () => {
    const out = await buildVizExport(fx.store, parseVizOptions({}));
    const m = out.content.match(
      /<script id="dbgraph-data" type="application\/json">([\s\S]*?)<\/script>/,
    );
    expect(m).not.toBeNull();
    const data = JSON.parse(m![1]!) as { nodes: unknown[]; edges: unknown[]; communities: unknown[] };
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(data.edges)).toBe(true);
    expect(Array.isArray(data.communities)).toBe(true);
  });

  it('HTML: two exports of the same graph are byte-identical (deterministic block)', async () => {
    const a = await buildVizExport(fx.store, parseVizOptions({}));
    const b = await buildVizExport(fx.store, parseVizOptions({}));
    expect(b.content).toBe(a.content);
  });

  it('mermaid: content === the B1 mermaid golden, outPath null (STDOUT) with no --out', async () => {
    const out = await buildVizExport(fx.store, parseVizOptions({ mermaid: true }));
    expect(out.mermaid).toBe(true);
    expect(out.outPath).toBe(null);
    expect(out.content).toBe(readFileSync(mermaidGoldenPath, 'utf-8'));
    // pure ER text — no JS, no deps
    expect(out.content).not.toContain('<script');
    expect(out.content).not.toContain('function');
  });

  it('mermaid: --out routes the ER text to the given path', async () => {
    const out = await buildVizExport(fx.store, parseVizOptions({ mermaid: true, out: 'er.mmd' }));
    expect(out.outPath).toBe('er.mmd');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.2 — handleViz end-to-end: writes graph.html + prints confirmation + exit 0
// ─────────────────────────────────────────────────────────────────────────────

describe('handleViz — writes a self-contained HTML and exits 0 (task 3.2)', () => {
  let projectRoot: string;
  let originalCwd: string;
  let mat: MaterializedDb;

  beforeAll(async () => {
    originalCwd = process.cwd();
    mat = materializeTorture();
    projectRoot = join(tmpdir(), `dbgraph-viz-e2e-${randomUUID()}`);
    mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });
    const cfg = buildConfig({ dialect: 'sqlite', file: mat.path });
    writeFileSync(join(projectRoot, 'dbgraph.config.json'), writeConfig(cfg), 'utf-8');
    process.chdir(projectRoot);
    const { dispatch } = await import('../../../src/cli/dispatch.js');
    const d = dispatch('sync');
    if (d.type !== 'handler') throw new Error('sync handler missing');
    await d.handler({ command: 'sync', positionals: [], flags: {} });
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
    mat.cleanup();
  });

  it('writes graph.html and prints a one-line confirmation carrying the path', async () => {
    const outPath = join(projectRoot, 'graph.html');
    const stdout: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      stdout.push(String(c));
      return true;
    });
    let outcome;
    try {
      outcome = await handleViz({ flags: { out: outPath } });
    } finally {
      spy.mockRestore();
    }
    expect(outcome).toStrictEqual({ type: 'success' });
    expect(existsSync(outPath)).toBe(true);
    const written = readFileSync(outPath, 'utf-8');
    expect(written.startsWith('<!doctype html>')).toBe(true);
    const confirmation = stdout.join('');
    expect(confirmation).toContain(outPath);
    expect(confirmation).toContain('Wrote self-contained graph HTML');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.5 — vendored provenance + license header (ISC, corrected from the design's MIT)
// ─────────────────────────────────────────────────────────────────────────────

describe('vendored d3 provenance + ISC header (task 3.5, closes OPEN-Q3)', () => {
  const VENDORED = ['d3-dispatch.js', 'd3-quadtree.js', 'd3-timer.js', 'd3-force.js'];

  it('PROVENANCE.md records a non-empty version and at least one 64-hex sha256', () => {
    const prov = readFileSync(join(vendorDir, 'PROVENANCE.md'), 'utf-8');
    expect(prov).toMatch(/3\.0\.\d+/); // a concrete pinned version
    const shas = prov.match(/\b[0-9a-f]{64}\b/g) ?? [];
    expect(shas.length).toBeGreaterThanOrEqual(4); // one per vendored package at least
    expect(prov.toLowerCase()).toContain('no cdn');
    expect(prov.toLowerCase()).toContain('not npm-installed');
  });

  it('every vendored file carries the ISC license header verbatim', () => {
    for (const f of VENDORED) {
      const src = readFileSync(join(vendorDir, f), 'utf-8');
      expect(src).toContain('Copyright 2010-2021 Mike Bostock');
      expect(src).toContain('Permission to use, copy, modify, and/or distribute this software');
      expect(src).toContain('License: ISC');
    }
  });

  it('adds ZERO new npm runtime dependency (d3 is a vendored asset, not a package dep)', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.some((d) => d.startsWith('d3'))).toBe(false);
  });
});
