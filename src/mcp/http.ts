/**
 * dbgraph MCP — Streamable HTTP transport seam (change: http-transport).
 *
 * This module owns the OPT-IN Streamable HTTP transport for the existing `mcp` verb.
 * It is additive and flag-gated: with `--http` ABSENT every consumer stays on the
 * byte-identical STDIO path (design D1).
 *
 * Batch 1 (this commit): the single PURE `parseMcpFlags` parser threaded through BOTH
 * MCP entry seams (SEA `sea-entry.planEntry` + the npm `dbgraph-mcp` bin guard), plus
 * the `startHttpMcpServer` launcher SIGNATURE. Batch 2 (task 2.4) implements the
 * `node:http` listener + per-session router body; Batch 2 (2.1/2.2/2.3) adds
 * `validateOriginHost`, `SessionRegistry`, and the STDERR logger it composes.
 *
 * ADR-004: imports ONLY the public barrel (../index.js) + @modelcontextprotocol/sdk +
 *          node:* builtins. NEVER src/adapters/** or src/cli/**.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { ConfigError, type GraphStore, type Logger } from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pinned defaults (design D4). 7423 is IANA-verified FREE (registered range, not a
// well-known port, no common dev-server collision).
// ─────────────────────────────────────────────────────────────────────────────

/** Default bind interface — loopback (the PRIMARY containment, design D3/D4). */
export const DEFAULT_MCP_HTTP_HOST = '127.0.0.1';
/** Default listener port (design D4, IANA cross-checked FREE). */
export const DEFAULT_MCP_HTTP_PORT = 7423;

// ─────────────────────────────────────────────────────────────────────────────
// Transport plan — the discriminated result of parseMcpFlags (design D1)
// ─────────────────────────────────────────────────────────────────────────────

/** The transport selection produced by {@link parseMcpFlags}. */
export type McpTransportPlan =
  | { readonly kind: 'stdio' }
  | { readonly kind: 'http'; readonly host: string; readonly port: number; readonly quiet: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// parseMcpFlags — PURE flag parser shared by BOTH MCP entry seams (design D1/D4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the transport flags that follow the `mcp` token (SEA seam) or the whole
 * `process.argv.slice(2)` (npm `dbgraph-mcp` bin — the bin IS the server, no token).
 *
 * PURE — no I/O, no listener. With `--http` ABSENT it returns `{ kind: 'stdio' }` so
 * both seams keep today's byte-identical STDIO path. Throws {@link ConfigError} (mapped
 * to exit 2 by the seams' existing DbgraphError catch) on an invalid `--port` value or
 * a `--host`/`--port` flag missing its explicit value.
 *
 * @param args flags AFTER the transport token.
 */
export function parseMcpFlags(args: readonly string[]): McpTransportPlan {
  let http = false;
  let host = DEFAULT_MCP_HTTP_HOST;
  let port = DEFAULT_MCP_HTTP_PORT;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--http':
        http = true;
        break;
      case '--port':
        i += 1;
        port = parsePortValue(args[i]);
        break;
      case '--host':
        i += 1;
        host = requireHostValue(args[i]);
        break;
      case '--quiet':
      case '-q':
        quiet = true;
        break;
      default:
        // Unknown/positional tokens are ignored (forward-compat; the bare `mcp` verb
        // with trailing junk still resolves to STDIO — no new branch off the flag).
        break;
    }
  }

  if (!http) {
    return { kind: 'stdio' };
  }
  return { kind: 'http', host, port, quiet };
}

/** Parses a `--port` value as an integer in 1–65535, else throws an actionable ConfigError. */
function parsePortValue(value: string | undefined): number {
  if (value === undefined) {
    throw new ConfigError(
      'The --port flag requires a value: an integer between 1 and 65535 (e.g. --port 7423).',
    );
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigError(
      `Invalid --port value: "${value}". Expected an integer between 1 and 65535.`,
    );
  }
  return parsed;
}

/** Requires an explicit `--host` value, else throws an actionable ConfigError. */
function requireHostValue(value: string | undefined): string {
  if (value === undefined || value.startsWith('-')) {
    throw new ConfigError(
      'The --host flag requires an explicit host value (e.g. --host 127.0.0.1 or --host 0.0.0.0).',
    );
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// startHttpMcpServer — Streamable HTTP launcher (design D2/D3/D4/D6/D7)
// SIGNATURE only in Batch 1; the node:http listener + per-session router body is
// implemented in Batch 2 (task 2.4), composing validateOriginHost (2.1), the
// SessionRegistry (2.2), and the STDERR logger (2.3).
// ─────────────────────────────────────────────────────────────────────────────

/** Options for {@link startHttpMcpServer}. */
export interface StartHttpMcpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly quiet?: boolean;
  readonly logger?: Logger;
}

/** Injectable dependencies for {@link startHttpMcpServer} (testing seam). */
export interface StartHttpMcpServerDeps {
  /** Per-session MCP Server factory; defaults to createDbgraphServer. */
  readonly createServer?: (store?: GraphStore) => Server;
}

/** The running HTTP listener handle returned by {@link startHttpMcpServer}. */
export interface HttpMcpServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Starts the Streamable HTTP MCP listener (design D2). Implemented in Batch 2 (2.4).
 */
export function startHttpMcpServer(
  opts: StartHttpMcpServerOptions,
  deps: StartHttpMcpServerDeps = {},
): Promise<HttpMcpServerHandle> {
  // Batch 2 (task 2.4) replaces this body with the node:http listener + per-session
  // StreamableHTTPServerTransport router. The Batch-1 flag seams are wired to this
  // symbol so the STDIO path stays byte-identical while the HTTP path lands next batch.
  const factory = deps.createServer === undefined ? 'default' : 'injected';
  return Promise.reject(
    new Error(
      `startHttpMcpServer is implemented in Batch 2 (task 2.4) of http-transport ` +
        `(requested ${opts.host}:${String(opts.port)}, createServer=${factory}).`,
    ),
  );
}
