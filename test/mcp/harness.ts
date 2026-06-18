/**
 * In-process MCP test harness — task 2.8 (phase-5-mcp-server).
 *
 * Creates a linked client/server pair via SDK InMemoryTransport and exposes
 * a minimal API for driving tool calls in tests.
 *
 * This harness does NOT open any database connections in Batch B — tools are
 * stubs that return "not implemented" text. Batches C/D will replace stubs with
 * real implementations that go through openConnections.
 *
 * Design §In-process harness skeleton:
 *   const [a, b] = InMemoryTransport.createLinkedPair();
 *   await server.connect(a); await client.connect(b);
 *   const r = await client.callTool({ name, arguments });
 *   const text = (r.content[0] as { text: string }).text;
 */

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Harness type
// ─────────────────────────────────────────────────────────────────────────────

export type McpTestHarness = {
  client: Client;
  /** Call a tool and return the first text content block. */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<string>;
  /** Tear down the linked transport pair. */
  close: () => Promise<void>;
};

// ─────────────────────────────────────────────────────────────────────────────
// createHarness — factory for test suites
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a linked in-process client/server pair.
 * Callers must await close() in afterAll to avoid open handles.
 */
export async function createHarness(server: Server): Promise<McpTestHarness> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: 'dbgraph-test-client', version: '0.0.0' },
    { capabilities: {} },
  );

  // Connect server and client concurrently (each blocks until the other is ready)
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    client,
    callTool: async (name: string, args?: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args ?? {} });
      const content = (result as { content: unknown[] }).content;
      const first = content[0] as { type: string; text?: string };
      if (first.type === 'text' && typeof first.text === 'string') {
        return first.text;
      }
      throw new Error(`callTool(${name}): first content block is not text (type: ${first.type})`);
    },
    close: async (): Promise<void> => {
      await client.close();
      await server.close();
    },
  };
}
