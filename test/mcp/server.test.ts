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

import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { startMcpServer } from '../../src/mcp/server.js';

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
