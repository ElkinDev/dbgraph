/**
 * In-process initialize test — task 2.8 (phase-5-mcp-server).
 * Spec: initialize returns the static golden instructions; each registered
 * tool description carries exactly one example call.
 *
 * Uses the InMemoryTransport harness (test/mcp/harness.ts) over the
 * createDbgraphServer factory (src/mcp/server.ts). No database or filesystem
 * access in this test — tools are stubs.
 *
 * TDD: RED (server not connected yet) → GREEN (harness + server scaffold done).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDbgraphServer } from '../../src/mcp/server.js';
import { createHarness, type McpTestHarness } from './harness.js';

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');
const instructionsGolden = join(projectRoot, 'test', 'mcp', 'golden', 'instructions.txt');

// ─────────────────────────────────────────────────────────────────────────────
// Harness setup
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_TOOL_COUNT = 8;
const EXPECTED_TOOL_NAMES = [
  'dbgraph_explore',
  'dbgraph_search',
  'dbgraph_object',
  'dbgraph_related',
  'dbgraph_impact',
  'dbgraph_path',
  'dbgraph_precheck',
  'dbgraph_status',
];

let harness: McpTestHarness;

beforeAll(async () => {
  const server = createDbgraphServer();
  harness = await createHarness(server);
});

afterAll(async () => {
  await harness.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MCP initialize', () => {
  it('server instructions match the golden instructions file', () => {
    // getInstructions() is available on the Client after connect()
    const instructions = harness.client.getInstructions();
    expect(instructions).toBeDefined();
    const golden = readFileSync(instructionsGolden, 'utf-8');
    expect(instructions).toBe(golden);
  });
});

describe('MCP ListTools', () => {
  it(`returns exactly ${EXPECTED_TOOL_COUNT} tools`, async () => {
    const result = await harness.client.listTools();
    expect(result.tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it('returns all 8 expected tool names', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('every tool has a non-empty description', async () => {
    const result = await harness.client.listTools();
    for (const tool of result.tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('every tool description contains exactly one "Example:" occurrence', async () => {
    const result = await harness.client.listTools();
    const violations: string[] = [];
    for (const tool of result.tools) {
      const desc = tool.description ?? '';
      const count = (desc.match(/Example:/g) ?? []).length;
      if (count !== 1) {
        violations.push(`${tool.name}: found ${count} Example: occurrences (expected 1)`);
      }
    }
    if (violations.length > 0) {
      expect.fail(
        `Tool description Example: count violations:\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it('every tool has a valid inputSchema with type: object', async () => {
    const result = await harness.client.listTools();
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('MCP CallTool (stub handlers)', () => {
  it('calling dbgraph_explore returns a text result (stub response)', async () => {
    const text = await harness.callTool('dbgraph_explore', { target: 'orders' });
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('calling an unknown tool returns an isError result with descriptive message', async () => {
    const result = await harness.client.callTool({
      name: 'dbgraph_unknown_tool',
      arguments: {},
    });
    // isError may be true or the SDK wraps the error differently
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    const firstText = content[0]?.text ?? '';
    expect(firstText.toLowerCase()).toContain('unknown tool');
  });
});
