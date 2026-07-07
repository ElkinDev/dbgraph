/**
 * Unit test for startMcpServer — the exported MCP-server launcher (design D5, phase-9.5c).
 *
 * The SEA binary reaches the MCP server as `dbgraph mcp`; sea-entry dispatches to
 * startMcpServer(). This test proves startMcpServer is exported and drives a real
 * MCP server over an INJECTED in-memory transport — WITHOUT the module's stdio
 * auto-run guard firing (importing the module must not start a real stdio server).
 * The existing auto-run guard for the npm `dbgraph-mcp` bin is preserved separately.
 *
 * TDD: RED (startMcpServer not exported yet) → GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { startMcpServer, runMcpBin } from '../../src/mcp/server.js';
import { ConfigError } from '../../src/index.js';

const EXPECTED_TOOL_COUNT = 8;

describe('startMcpServer (task 1.3, design D5)', () => {
  it('is an exported callable function', () => {
    expect(typeof startMcpServer).toBe('function');
  });

  it('connects over an INJECTED transport and serves all 8 tools (no stdio, no auto-run guard)', async () => {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'sea-entry-test-client', version: '0.0.0' },
      { capabilities: {} },
    );

    // Each side blocks until the other is ready — mirror the in-process harness.
    await Promise.all([
      startMcpServer(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const result = await client.listTools();
      expect(result.tools.length).toBe(EXPECTED_TOOL_COUNT);
    } finally {
      await client.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runMcpBin — the npm `dbgraph-mcp` auto-run dispatch, extracted for testability
// (task 1.3, design D1). Parses `process.argv.slice(2)` via the SHARED parseMcpFlags
// → stdio (default, byte-identical) vs startHttpMcpServer. createDbgraphServer /
// startMcpServer / the 8-tool table stay UNTOUCHED.
// ─────────────────────────────────────────────────────────────────────────────

describe('runMcpBin — shared parseMcpFlags dispatch for the npm bin (task 1.3, design D1)', () => {
  it('is an exported callable function', () => {
    expect(typeof runMcpBin).toBe('function');
  });

  it('bare argv [] → stdio path fires (startStdio), NO http branch, no new output', async () => {
    const startStdio = vi.fn(async () => undefined);
    const startHttp = vi.fn(async () => ({ port: 0, close: async () => undefined }));

    await runMcpBin([], { startStdio, startHttp });

    expect(startStdio).toHaveBeenCalledTimes(1);
    expect(startStdio).toHaveBeenCalledWith(); // no args — today's exact call
    expect(startHttp).not.toHaveBeenCalled();
  });

  it('argv ["--http"] → http path selected with pinned defaults, stdio NOT fired', async () => {
    const startStdio = vi.fn(async () => undefined);
    const startHttp = vi.fn(async () => ({ port: 7423, close: async () => undefined }));

    await runMcpBin(['--http'], { startStdio, startHttp });

    expect(startHttp).toHaveBeenCalledTimes(1);
    expect(startHttp).toHaveBeenCalledWith({ host: '127.0.0.1', port: 7423, quiet: false });
    expect(startStdio).not.toHaveBeenCalled();
  });

  it('argv ["--http","--host","0.0.0.0","--port","8080","--quiet"] → http opts threaded verbatim', async () => {
    const startStdio = vi.fn(async () => undefined);
    const startHttp = vi.fn(async () => ({ port: 8080, close: async () => undefined }));

    await runMcpBin(['--http', '--host', '0.0.0.0', '--port', '8080', '--quiet'], { startStdio, startHttp });

    expect(startHttp).toHaveBeenCalledWith({ host: '0.0.0.0', port: 8080, quiet: true });
    expect(startStdio).not.toHaveBeenCalled();
  });

  it('invalid --port → rejects with ConfigError (the bin catch maps it to exit 2)', async () => {
    const startStdio = vi.fn(async () => undefined);
    const startHttp = vi.fn(async () => ({ port: 0, close: async () => undefined }));

    await expect(runMcpBin(['--http', '--port', 'notaport'], { startStdio, startHttp })).rejects.toBeInstanceOf(
      ConfigError,
    );
    expect(startStdio).not.toHaveBeenCalled();
    expect(startHttp).not.toHaveBeenCalled();
  });
});
