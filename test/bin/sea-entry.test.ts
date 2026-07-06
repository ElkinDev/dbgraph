/**
 * Unit tests for planEntry — the PURE SEA dispatch planner (design D5, phase-9.5c).
 *
 * Batch 0.2 EMPIRICAL FINDING (Node 24.18.0 win-x64): a SEA `process.argv` is
 *   [execPath, execPath, ...userArgs]
 * — Node fills the argv[1] script slot with the executable path, so user args start
 * at index 2, IDENTICAL to a normal `node <script> ...` launch. Design D5/Q3 assumed
 * `[execPath, ...args]` / slice(1); the spike corrected the SEA offset to slice(2)
 * (see design.md "Batch 0 — empirical findings"). These tests pin the CORRECTED offset.
 *
 * planEntry is pure — NO spawn, NO import.meta guard. The unconditional runner glue is
 * smoke-covered in Batch 2.6.
 *
 * TDD: RED (sea-entry.ts does not exist yet) → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { planEntry } from '../../src/bin/sea-entry.js';

// A SEA argv duplicates the executable path in argv[0] AND argv[1] (Batch 0.2).
const EXE = 'C:\\opt\\dbgraph\\dbgraph-win-x64.exe';
// A normal node launch: [nodePath, scriptPath, ...userArgs].
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const SCRIPT = 'C:\\repo\\dist\\bin\\sea-entry.js';

describe('planEntry — SEA argv (offset = slice(2), Batch 0.2 correction)', () => {
  it('SEA cli args start at index 2: [exe, exe, "query", "Foo"] → cli ["query","Foo"]', () => {
    expect(planEntry([EXE, EXE, 'query', 'Foo'], true)).toStrictEqual({
      mode: 'cli',
      args: ['query', 'Foo'],
    });
  });

  it('SEA "mcp" as the first user arg routes to mcp: [exe, exe, "mcp"] → { mode: "mcp" }', () => {
    expect(planEntry([EXE, EXE, 'mcp'], true)).toStrictEqual({ mode: 'mcp' });
  });

  it('SEA "mcp" with trailing args still routes to mcp', () => {
    expect(planEntry([EXE, EXE, 'mcp', 'extra'], true)).toStrictEqual({ mode: 'mcp' });
  });

  it('SEA --version pass-through: [exe, exe, "--version"] → cli ["--version"]', () => {
    expect(planEntry([EXE, EXE, '--version'], true)).toStrictEqual({
      mode: 'cli',
      args: ['--version'],
    });
  });

  it('SEA --help pass-through: [exe, exe, "--help"] → cli ["--help"]', () => {
    expect(planEntry([EXE, EXE, '--help'], true)).toStrictEqual({
      mode: 'cli',
      args: ['--help'],
    });
  });

  it('SEA empty user args: [exe, exe] → cli []', () => {
    expect(planEntry([EXE, EXE], true)).toStrictEqual({ mode: 'cli', args: [] });
  });
});

describe('planEntry — non-SEA argv (node <script> ... → slice(2))', () => {
  it('non-SEA cli args start at index 2: [node, script, "query", "Foo"] → cli ["query","Foo"]', () => {
    expect(planEntry([NODE, SCRIPT, 'query', 'Foo'], false)).toStrictEqual({
      mode: 'cli',
      args: ['query', 'Foo'],
    });
  });

  it('non-SEA "mcp" routes to mcp: [node, script, "mcp"] → { mode: "mcp" }', () => {
    expect(planEntry([NODE, SCRIPT, 'mcp'], false)).toStrictEqual({ mode: 'mcp' });
  });

  it('non-SEA empty user args: [node, script] → cli []', () => {
    expect(planEntry([NODE, SCRIPT], false)).toStrictEqual({ mode: 'cli', args: [] });
  });
});
