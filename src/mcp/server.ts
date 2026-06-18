#!/usr/bin/env node
/**
 * dbgraph MCP stdio server — task 2.7 (phase-5-mcp-server).
 *
 * Exposes the dbgraph graph as 8 MCP tools over stdio transport:
 *   dbgraph_explore, dbgraph_search, dbgraph_object, dbgraph_related,
 *   dbgraph_impact, dbgraph_path, dbgraph_precheck, dbgraph_status
 *
 * Design Decision 7 (phase-5-mcp-server):
 *   - Uses the low-level SDK Server class with ListTools/CallTool request handlers
 *   - One tool-name → { description, inputSchema, run } table
 *   - DbgraphError → MCP tool error result (isError: true, never throw)
 *   - Static initialize instructions from src/mcp/instructions.ts
 *   - openConnections from the barrel (ADR-004: MCP imports barrel only)
 *
 * Task 3.1–3.5 (Batch C): five simple tools wired with real handlers.
 *   createDbgraphServer(storeOverride?) accepts an optional GraphStore for
 *   in-process testing — when provided, tools use it directly without calling
 *   openConnections (harness injection pattern).
 *
 * ADR-004: imports ONLY src/index.ts (barrel) + Node builtins +
 *          @modelcontextprotocol/sdk. NEVER src/adapters/** or src/cli/**.
 */

import {
  Server,
  type ServerOptions,
} from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { DBGRAPH_INSTRUCTIONS } from './instructions.js';
import { DbgraphError, openConnections, type GraphStore } from '../index.js';

// ── Batch C tool handlers ─────────────────────────────────────────────────────
import { runExploreTool } from './tools/explore.js';
import { runSearchTool } from './tools/search.js';
import { runRelatedTool } from './tools/related.js';
import { runPathTool } from './tools/path.js';
import { runStatusTool } from './tools/status.js';

// ── Batch D tool handlers ─────────────────────────────────────────────────────
import { runObjectTool } from './tools/object.js';
import { runImpactTool } from './tools/impact.js';
import { runPrecheckTool } from './tools/precheck.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition type
// ─────────────────────────────────────────────────────────────────────────────

type JsonSchemaObject = {
  type: 'object';
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
};

type ToolDefinition = {
  description: string;
  inputSchema: JsonSchemaObject;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
};

// ─────────────────────────────────────────────────────────────────────────────
// buildToolTable — constructs the tool table wired to a given store (or stubs)
// When store is undefined, real tools fall back to stub behaviour; this should
// only happen in the stdio entry path where openConnections is called per-request.
// ─────────────────────────────────────────────────────────────────────────────

function buildToolTable(store: GraphStore | undefined): Readonly<Record<string, ToolDefinition>> {
  const withStore = (
    handler: (s: GraphStore, args: Record<string, unknown>) => Promise<CallToolResult>,
  ): ToolDefinition['run'] => {
    return async (args: Record<string, unknown>): Promise<CallToolResult> => {
      if (store !== undefined) {
        // In-process harness path: use the injected store directly (tasks 3.x–5.x)
        return handler(store, args);
      }

      // Stdio production path (Batch E): open connections from dbgraph.config.json per call.
      // Project root = cwd of the process that launched the stdio server (the user's project).
      // The store is opened and closed within each request for safety.
      const { adapter, store: s } = await openConnections(process.cwd());
      try {
        return await handler(s, args);
      } finally {
        await s.close();
        await adapter.close();
      }
    };
  };

  // Special handler for status: passes the live adapter so drift can be computed.
  // When a storeOverride is injected (harness), falls back to connectionless (no adapter).
  const withStoreForStatus: ToolDefinition['run'] = async (
    args: Record<string, unknown>,
  ): Promise<CallToolResult> => {
    if (store !== undefined) {
      // Connectionless harness path — no live adapter available
      return runStatusTool(store, args);
    }

    // Production path — open adapter + store, pass both to the tool for live drift
    const { adapter, store: s } = await openConnections(process.cwd());
    try {
      return await runStatusTool(s, args, adapter);
    } finally {
      await s.close();
      await adapter.close();
    }
  };

  return {
    dbgraph_explore: {
      description:
        'Returns a compact neighborhood (direct neighbors grouped by edge kind) for a given ' +
        'table, view, or procedure. Use when you know the object name and want to see what ' +
        'it connects to. Returns a disambiguation list when the name is ambiguous. ' +
        'Example: dbgraph_explore({ target: "orders", detail: "normal" })',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Table, view, or procedure name (qualified or unqualified).',
          },
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: ['target'],
      },
      run: withStore(runExploreTool),
    },

    dbgraph_search: {
      description:
        'Full-text search over database object names and bodies (FTS5 with typo tolerance). ' +
        'Returns ranked hits with type and qualified name. Paginate via offset/limit. ' +
        'Example: dbgraph_search({ query: "customer invoice", offset: 0, limit: 10 })',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term (supports typo tolerance).',
          },
          offset: {
            type: 'integer',
            description: 'Pagination offset. Default: 0.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum results per page. Default: 20.',
          },
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: ['query'],
      },
      run: withStore(runSearchTool),
    },

    dbgraph_object: {
      description:
        'Assembles full detail for one database object: columns with type/nullability/default, ' +
        'PK/FK/check constraints, indexes, triggers, and (at full detail) the body. ' +
        'Returns a disambiguation list when the name matches multiple schemas. ' +
        'Example: dbgraph_object({ qname: "dbo.orders", detail: "full" })',
      inputSchema: {
        type: 'object',
        properties: {
          qname: {
            type: 'string',
            description: 'Qualified or unqualified object name (e.g. "dbo.orders").',
          },
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: ['qname'],
      },
      run: withStore(runObjectTool),
    },

    dbgraph_related: {
      description:
        'Returns neighbors of a database object grouped by edge kind and direction ' +
        '(references in/out, depends_on, reads_from/writes_to, fires_on). ' +
        'Inferred edges appear in a separate group with their score. ' +
        'Example: dbgraph_related({ qname: "dbo.orders", kinds: ["references"] })',
      inputSchema: {
        type: 'object',
        properties: {
          qname: {
            type: 'string',
            description: 'Qualified or unqualified object name.',
          },
          kinds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Edge kinds to include. Omit for all kinds.',
          },
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: ['qname'],
      },
      run: withStore(runRelatedTool),
    },

    dbgraph_impact: {
      description:
        'Returns the transitive read/write blast radius from a database object as a visible ' +
        'dependency chain (a→b→c). Separates READ impact from WRITE impact. Warns when depth ' +
        'is truncated or when any node has dynamic SQL (impact possibly incomplete). ' +
        'Example: dbgraph_impact({ qname: "dbo.orders", depth: 3 })',
      inputSchema: {
        type: 'object',
        properties: {
          qname: {
            type: 'string',
            description: 'Qualified or unqualified object name.',
          },
          depth: {
            type: 'integer',
            description: 'Maximum traversal depth. Default: 3.',
          },
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: ['qname'],
      },
      run: withStore(runImpactTool),
    },

    dbgraph_path: {
      description:
        'Returns the shortest JOIN path between two tables over declared FK references, ' +
        'exposing the exact join columns of each hop. An inferred-only route is marked inferred. ' +
        'When no route exists, suggests the closest neighbors of each endpoint. ' +
        'Example: dbgraph_path({ from: "customers", to: "shipments" })',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Starting table name (qualified or unqualified).',
          },
          to: {
            type: 'string',
            description: 'Target table name (qualified or unqualified).',
          },
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: ['from', 'to'],
      },
      run: withStore(runPathTool),
    },

    dbgraph_precheck: {
      description:
        'Analyzes DDL statements (ALTER TABLE, CREATE/DROP INDEX, ADD/DROP COLUMN) and ' +
        'returns aggregated impact: triggers firing on affected objects, who writes/reads them, ' +
        'constraints/indexes involved, and what to test. Every result carries confidence: parsed. ' +
        'Identifiers with no matching graph node are reported as unmatched, never guessed. ' +
        'Example: dbgraph_precheck({ ddl: "ALTER TABLE dbo.orders DROP COLUMN status" })',
      inputSchema: {
        type: 'object',
        properties: {
          ddl: {
            type: 'string',
            description: 'DDL statement(s) to analyze.',
          },
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: ['ddl'],
      },
      run: withStore(runPrecheckTool),
    },

    dbgraph_status: {
      description:
        'Reports engine, last sync timestamp, per-type object counts, configured index levels, ' +
        'excluded objects, and schema drift (live fingerprint when a connection is available, ' +
        'otherwise states drift could not be checked). Run this before schema changes. ' +
        'Example: dbgraph_status({ detail: "normal" })',
      inputSchema: {
        type: 'object',
        properties: {
          detail: {
            type: 'string',
            enum: ['brief', 'normal', 'full'],
            description: 'Output detail level. Default: normal.',
          },
        },
        required: [],
      },
      run: withStoreForStatus,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DbgraphError → CallToolResult (isError: true)
// ─────────────────────────────────────────────────────────────────────────────

function dbgraphErrorToResult(err: DbgraphError): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `[${err.code}] ${err.message}`,
      },
    ],
    isError: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server factory — exported for in-process testing (task 2.8)
// Accepts an optional GraphStore for harness injection (tasks 3.1–3.5).
// When storeOverride is provided, tools use it directly without openConnections.
// When undefined (stdio path), the "withStore" wrapper returns a placeholder
// until Batch E wires the real openConnections per-call pattern.
// ─────────────────────────────────────────────────────────────────────────────

export function createDbgraphServer(storeOverride?: GraphStore): Server {
  const TOOL_TABLE = buildToolTable(storeOverride);

  const options: ServerOptions = {
    capabilities: {
      tools: {},
    },
    instructions: DBGRAPH_INSTRUCTIONS,
  };

  const server = new Server(
    { name: 'dbgraph', version: '0.0.0' },
    options,
  );

  // ── ListTools handler ────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Object.entries(TOOL_TABLE).map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: def.inputSchema,
      })),
    };
  });

  // ── CallTool handler ─────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    const tool = TOOL_TABLE[name];
    if (tool === undefined) {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: "${name}". Available tools: ${Object.keys(TOOL_TABLE).join(', ')}.`,
          },
        ],
        isError: true,
      } satisfies CallToolResult;
    }

    const args: Record<string, unknown> = (rawArgs ?? {}) as Record<string, unknown>;

    try {
      return await tool.run(args);
    } catch (err) {
      if (err instanceof DbgraphError) {
        return dbgraphErrorToResult(err);
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Internal error: ${message}` }],
        isError: true,
      } satisfies CallToolResult;
    }
  });

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stdio entry point — only runs when executed directly, not when imported
// ─────────────────────────────────────────────────────────────────────────────

// Detect if we are the main module (ESM-compatible check)
const isMain = process.argv[1] !== undefined &&
  (import.meta.url.endsWith(process.argv[1]) ||
   import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
   process.argv[1].includes('server.'));

if (isMain) {
  const server = createDbgraphServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
