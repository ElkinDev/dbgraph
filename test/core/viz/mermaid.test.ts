/**
 * Task 1.6 — RED→GREEN: pure deterministic Mermaid ER emitter.
 *
 * `emitMermaidER(nodes, edges)` emits a Mermaid ER diagram containing ONLY tables (as
 * entities, canonical qname order) and their FK `references` relationships (resolved to
 * table→table, deterministically sorted), with ZERO JavaScript and ZERO dependencies.
 * Two runs on the torture fixture MUST be byte-identical to each other AND to the golden.
 *
 * Spec scenario `graph-viz` "mermaid ER matches the torture-fixture golden byte-for-byte".
 * ADR-008 byte-pin. L-009: exact byte compares, no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitMermaidER } from '../../../src/core/viz/mermaid.js';
import { loadTortureGraph, type TortureGraph } from './torture-graph.js';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const CAPTURE = process.env['GOLDEN_CAPTURE'] === '1';

let g: TortureGraph;

beforeAll(async () => {
  g = await loadTortureGraph();
});

afterAll(async () => {
  await g.cleanup();
});

describe('emitMermaidER — pure deterministic ER diagram', () => {
  it('starts with the erDiagram header', () => {
    const out = emitMermaidER(g.nodes, g.edges);
    expect(out.startsWith('erDiagram\n')).toBe(true);
  });

  it('declares every table as an entity, in canonical qname order', () => {
    const out = emitMermaidER(g.nodes, g.edges);
    const tableQnames = g.nodes
      .filter((n) => n.kind === 'table')
      .map((n) => n.qname)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // every table appears as a quoted entity
    for (const qn of tableQnames) {
      expect(out).toContain(`"${qn}" {`);
    }
    // and the entity declarations are in ascending qname order (canonical)
    const positions = tableQnames.map((qn) => out.indexOf(`"${qn}" {`));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toStrictEqual(sorted);
  });

  it('renders the employees→departments FK as a table-level references relationship', () => {
    const out = emitMermaidER(g.nodes, g.edges);
    expect(out).toContain('"main.departments" ||--o{ "main.employees" : references');
  });

  it('contains ZERO JavaScript / dependencies (pure ER text)', () => {
    const out = emitMermaidER(g.nodes, g.edges);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('function');
    expect(out).not.toContain('import ');
    expect(out).not.toContain('require(');
  });

  it('is byte-identical across two runs and order-independent', () => {
    const a = emitMermaidER(g.nodes, g.edges);
    const b = emitMermaidER(g.nodes, g.edges);
    expect(b).toBe(a);
    const c = emitMermaidER([...g.nodes].reverse(), [...g.edges].reverse());
    expect(c).toBe(a);
  });

  it('matches the blessed mermaid-er golden byte-for-byte', () => {
    const actual = emitMermaidER(g.nodes, g.edges);
    const goldenPath = join(goldenDir, 'mermaid-er.mmd');
    if (CAPTURE || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, actual, 'utf-8');
      if (CAPTURE) return;
    }
    expect(actual).toBe(readFileSync(goldenPath, 'utf-8'));
  });
});
