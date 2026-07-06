/**
 * Unit tests for planEntry — the PURE SEA dispatch planner (design D5, phase-9.5c),
 * EXTENDED for the http-transport change (task 1.2, design D1).
 *
 * Batch 0.2 EMPIRICAL FINDING (Node 24.18.0 win-x64): a SEA `process.argv` is
 *   [execPath, execPath, ...userArgs]
 * — Node fills the argv[1] script slot with the executable path, so user args start
 * at index 2, IDENTICAL to a normal `node <script> ...` launch. Design D5/Q3 assumed
 * `[execPath, ...args]` / slice(1); the spike corrected the SEA offset to slice(2)
 * (see design.md "Batch 0 — empirical findings"). These tests pin the CORRECTED offset.
 *
 * http-transport (task 1.2): the `mcp` EntryPlan now carries a `transport` field —
 * `parseMcpFlags(argsAfter 'mcp')` — so runSeaEntry can dispatch stdio → startMcpServer()
 * vs http → startHttpMcpServer(opts). With `--http` ABSENT the plan is
 * `{ mode:'mcp', transport:{ kind:'stdio' } }` — today's byte-identical STDIO path.
 *
 * planEntry is pure — NO spawn, NO import.meta guard. The unconditional runner glue is
 * smoke-covered in Batch 2.6.
 *
 * TDD: RED (EntryPlan.mcp had no transport field) → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { planEntry } from '../../src/bin/sea-entry.js';
import { ConfigError } from '../../src/index.js';

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

  it('SEA "mcp" as the first user arg routes to mcp STDIO: [exe, exe, "mcp"] → { mode:"mcp", transport:{kind:"stdio"} }', () => {
    expect(planEntry([EXE, EXE, 'mcp'], true)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'stdio' },
    });
  });

  it('SEA "mcp" with a non-flag trailing arg still routes to mcp STDIO', () => {
    expect(planEntry([EXE, EXE, 'mcp', 'extra'], true)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'stdio' },
    });
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

  it('non-SEA "mcp" routes to mcp STDIO: [node, script, "mcp"] → { mode:"mcp", transport:{kind:"stdio"} }', () => {
    expect(planEntry([NODE, SCRIPT, 'mcp'], false)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'stdio' },
    });
  });

  it('non-SEA empty user args: [node, script] → cli []', () => {
    expect(planEntry([NODE, SCRIPT], false)).toStrictEqual({ mode: 'cli', args: [] });
  });
});

describe('planEntry — http-transport flags threaded via parseMcpFlags (task 1.2, design D1/D4)', () => {
  it('SEA "mcp --http" → http transport plan with pinned defaults', () => {
    expect(planEntry([EXE, EXE, 'mcp', '--http'], true)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'http', host: '127.0.0.1', port: 7423, quiet: false },
    });
  });

  it('SEA "mcp --http --port 7423" → http plan with explicit port', () => {
    expect(planEntry([EXE, EXE, 'mcp', '--http', '--port', '7423'], true)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'http', host: '127.0.0.1', port: 7423, quiet: false },
    });
  });

  it('non-SEA "mcp --http --host 0.0.0.0 --port 9000 --quiet" → full http override plan', () => {
    expect(planEntry([NODE, SCRIPT, 'mcp', '--http', '--host', '0.0.0.0', '--port', '9000', '--quiet'], false)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'http', host: '0.0.0.0', port: 9000, quiet: true },
    });
  });

  it('the mcp token is stripped before parseMcpFlags — a bare "mcp" is NOT treated as an http flag', () => {
    expect(planEntry([EXE, EXE, 'mcp'], true)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'stdio' },
    });
  });

  it('invalid --port surfaces ConfigError from planEntry (the seam catch maps it to exit 2)', () => {
    expect(() => planEntry([EXE, EXE, 'mcp', '--http', '--port', 'notaport'], true)).toThrow(ConfigError);
  });

  it('non-mcp argv is never routed through parseMcpFlags (cli path unchanged even with --http-looking args)', () => {
    // Leading token is not "mcp" → cli path, args preserved verbatim, no parse, no throw.
    expect(planEntry([EXE, EXE, 'query', '--http'], true)).toStrictEqual({
      mode: 'cli',
      args: ['query', '--http'],
    });
  });
});
