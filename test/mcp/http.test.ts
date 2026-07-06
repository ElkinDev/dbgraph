/**
 * Unit tests for src/mcp/http.ts — the HTTP-transport seam (change: http-transport).
 *
 * Batch 1 (task 1.1): parseMcpFlags — the SINGLE pure flag parser threaded through
 * BOTH MCP entry seams (SEA planEntry + npm dbgraph-mcp bin guard). Design D1/D4.
 *
 * STRICT TDD: these tests are written RED first (src/mcp/http.ts::parseMcpFlags does
 * not exist yet), seen failing, then implemented GREEN. parseMcpFlags is PURE — no
 * I/O, no listener — so the off-flag branch keeps the STDIO path byte-identical.
 */

import { describe, it, expect, vi } from 'vitest';

import { parseMcpFlags } from '../../src/mcp/http.js';
import { ConfigError } from '../../src/index.js';
import { planEntry } from '../../src/bin/sea-entry.js';
import { createDbgraphServer, runMcpBin } from '../../src/mcp/server.js';
import { createHarness } from './harness.js';

// Design D4 pinned defaults.
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 7423;

describe('parseMcpFlags — pure transport-flag parser (task 1.1, design D1/D4)', () => {
  it('no flags → stdio plan (bare mcp stays byte-identical STDIO)', () => {
    expect(parseMcpFlags([])).toStrictEqual({ kind: 'stdio' });
  });

  it('--http → http plan with pinned defaults (host 127.0.0.1, port 7423, quiet false)', () => {
    expect(parseMcpFlags(['--http'])).toStrictEqual({
      kind: 'http',
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      quiet: false,
    });
  });

  it('--http --port 8000 → port overridden to 8000', () => {
    expect(parseMcpFlags(['--http', '--port', '8000'])).toStrictEqual({
      kind: 'http',
      host: DEFAULT_HOST,
      port: 8000,
      quiet: false,
    });
  });

  it('--http --host 0.0.0.0 → host overridden', () => {
    expect(parseMcpFlags(['--http', '--host', '0.0.0.0'])).toStrictEqual({
      kind: 'http',
      host: '0.0.0.0',
      port: DEFAULT_PORT,
      quiet: false,
    });
  });

  it('--http --quiet → quiet true', () => {
    expect(parseMcpFlags(['--http', '--quiet'])).toStrictEqual({
      kind: 'http',
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      quiet: true,
    });
  });

  it('--http -q → quiet true (short form)', () => {
    expect(parseMcpFlags(['--http', '-q'])).toStrictEqual({
      kind: 'http',
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      quiet: true,
    });
  });

  it('all overrides combine: --http --host 0.0.0.0 --port 9000 --quiet', () => {
    expect(parseMcpFlags(['--http', '--host', '0.0.0.0', '--port', '9000', '--quiet'])).toStrictEqual({
      kind: 'http',
      host: '0.0.0.0',
      port: 9000,
      quiet: true,
    });
  });

  it('--http --port notaport → throws ConfigError naming the offending value', () => {
    expect(() => parseMcpFlags(['--http', '--port', 'notaport'])).toThrow(ConfigError);
    expect(() => parseMcpFlags(['--http', '--port', 'notaport'])).toThrow(/notaport/);
  });

  it('--http --port 0 → throws ConfigError (out of 1–65535 range)', () => {
    expect(() => parseMcpFlags(['--http', '--port', '0'])).toThrow(ConfigError);
  });

  it('--http --port 65536 → throws ConfigError (out of 1–65535 range)', () => {
    expect(() => parseMcpFlags(['--http', '--port', '65536'])).toThrow(ConfigError);
  });

  it('--http --port 80.5 → throws ConfigError (not an integer)', () => {
    expect(() => parseMcpFlags(['--http', '--port', '80.5'])).toThrow(ConfigError);
  });

  it('--http --port (no value) → throws ConfigError', () => {
    expect(() => parseMcpFlags(['--http', '--port'])).toThrow(ConfigError);
  });

  it('--http --host (no value) → throws ConfigError requiring an explicit host', () => {
    expect(() => parseMcpFlags(['--http', '--host'])).toThrow(ConfigError);
  });

  it('--http --host followed by a flag → throws ConfigError (no explicit value)', () => {
    expect(() => parseMcpFlags(['--http', '--host', '--quiet'])).toThrow(ConfigError);
  });

  it('is pure — repeated calls with the same input yield equal, independent results', () => {
    const a = parseMcpFlags(['--http', '--port', '8000']);
    const b = parseMcpFlags(['--http', '--port', '8000']);
    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STDIO byte-identity regression (task 1.4, design D1). With `--http` ABSENT BOTH
// entry seams (SEA planEntry + npm dbgraph-mcp bin guard) MUST reach startMcpServer()
// with NO args — today's exact path — and NO listener socket may be bound. The
// phase-5 InMemoryTransport goldens still pin the untouched 8-tool factory surface.
// (The `git diff --exit-code test/mcp/golden/` EMPTY check is enforced at the gate.)
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_TOOL_NAMES = [
  'dbgraph_explore',
  'dbgraph_search',
  'dbgraph_object',
  'dbgraph_related',
  'dbgraph_impact',
  'dbgraph_path',
  'dbgraph_precheck',
  'dbgraph_status',
] as const;

describe('STDIO byte-identity regression — no --http = today’s exact path (task 1.4, design D1)', () => {
  it('parseMcpFlags([]) is the single stdio source both seams derive from', () => {
    expect(parseMcpFlags([])).toStrictEqual({ kind: 'stdio' });
  });

  it('SEA seam: bare "mcp" → { mode:"mcp", transport:{kind:"stdio"} } (no http branch)', () => {
    const EXE = 'C:\\opt\\dbgraph\\dbgraph.exe';
    expect(planEntry([EXE, EXE, 'mcp'], true)).toStrictEqual({
      mode: 'mcp',
      transport: { kind: 'stdio' },
    });
  });

  it('npm bin seam: bare argv [] → startMcpServer() with NO args, and NO socket-binding http path fires', async () => {
    const startStdio = vi.fn(async () => undefined);
    const startHttp = vi.fn(async () => ({ port: 0, close: async () => undefined }));

    await runMcpBin([], { startStdio, startHttp });

    // Byte-identical: stdio launcher invoked exactly once, with zero arguments.
    expect(startStdio).toHaveBeenCalledTimes(1);
    expect(startStdio).toHaveBeenCalledWith();
    // The HTTP launcher is the ONLY code path that binds a TCP socket — it must NOT run.
    expect(startHttp).not.toHaveBeenCalled();
  });

  it('the createDbgraphServer factory still exposes exactly the 8 tools (factory untouched)', async () => {
    const harness = await createHarness(createDbgraphServer());
    try {
      const listed = await harness.client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      expect(names).toStrictEqual([...EXPECTED_TOOL_NAMES].sort());
    } finally {
      await harness.close();
    }
  });
});
