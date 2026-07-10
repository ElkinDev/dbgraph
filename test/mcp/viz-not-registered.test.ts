/**
 * Task 3.7c — RED→GREEN: `viz` is a CLI-only human artifact, NEVER an MCP tool.
 *
 * An interactive picture is a human artifact, not a token-economy tool result (ADR-008).
 * The MCP tool registry MUST expose ZERO `viz` / `dbgraph_viz` tool. Inspected live via the
 * SDK InMemoryTransport client over the real `createDbgraphServer` factory.
 *
 * Spec `graph-viz`: "viz is not registered as an MCP tool". L-009: exact assertions.
 */

import { describe, it, expect } from 'vitest';
import { createDbgraphServer } from '../../src/mcp/server.js';
import { createHarness } from './harness.js';

describe('viz is not an MCP tool (task 3.7c)', () => {
  it('the tool registry contains no viz / dbgraph_viz tool', async () => {
    const harness = await createHarness(createDbgraphServer());
    try {
      const listed = await harness.client.listTools();
      const names = listed.tools.map((t) => t.name);
      expect(names.some((n) => /viz/i.test(n))).toBe(false);
      expect(names.includes('dbgraph_viz')).toBe(false);
      expect(names.includes('viz')).toBe(false);
    } finally {
      await harness.close();
    }
  });
});
