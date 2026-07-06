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

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { ConfigError, type GraphStore, type Logger } from '../index.js';
import { createDbgraphServer } from './server.js';

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
// validateOriginHost — PURE in-house DNS-rebinding defense (design D3).
// NOT the deprecated SDK allowedHosts/allowedOrigins/enableDnsRebindingProtection.
// ─────────────────────────────────────────────────────────────────────────────

/** The result of {@link validateOriginHost}. */
export type OriginHostDecision = { ok: true } | { ok: false; status: 403; reason: string };

/** Hostnames treated as loopback (bracket-stripped, lower-cased). */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

/** Strips IPv6 brackets: `[::1]` → `::1`. */
function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/** True when the (bracket-stripped, lower-cased) hostname is a loopback address. */
function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(stripBrackets(hostname.toLowerCase()));
}

/** Extracts the hostname from a `Host` header value (`host`, `host:port`, `[::1]`, `[::1]:port`). */
function hostHeaderHostname(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1); // keep brackets, drop the :port
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/** Parses an `Origin` header into its hostname, or undefined when malformed. */
function originHostname(origin: string): string | undefined {
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
}

/**
 * PURE Origin/Host allowlist (design D3). Runs BEFORE `transport.handleRequest` in the
 * router (2.4); a rejection short-circuits to HTTP 403 with a content-free JSON-RPC
 * `{ jsonrpc, error:{ code:-32000, message:'Forbidden' }, id:null }` body BEFORE any tool
 * handler runs. The loopback-default bind is the PRIMARY containment; this is defense-in-depth.
 *
 * Policy:
 * - **Origin** absent → allow (MCP agents send none); present → allow only loopback origins
 *   (`http://localhost|127.0.0.1|[::1][:port]`), else 403. This check ALWAYS applies (incl. 0.0.0.0).
 * - **Host** on a loopback bind → allow only `{127.0.0.1, localhost, [::1]}(:port)`, else 403.
 *   On a non-loopback bind (`0.0.0.0`, LAN IP) the external hostname is unknowable → Host RELAXED.
 */
export function validateOriginHost(input: {
  headers: { host?: string | undefined; origin?: string | undefined };
  bindHost: string;
  port: number;
}): OriginHostDecision {
  const { headers, bindHost } = input;

  // Origin allowlist — ALWAYS enforced (the DNS-rebinding vector is a foreign Origin).
  const { origin } = headers;
  if (origin !== undefined) {
    const hostname = originHostname(origin);
    if (hostname === undefined || !isLoopbackHostname(hostname)) {
      return { ok: false, status: 403, reason: `origin not allowed: ${origin}` };
    }
  }

  // Host allowlist — only meaningful on a loopback bind (relaxed on 0.0.0.0 / LAN IP).
  if (isLoopbackHostname(bindHost)) {
    const { host } = headers;
    if (host === undefined || !isLoopbackHostname(hostHeaderHostname(host))) {
      return { ok: false, status: 403, reason: `host not allowed: ${host ?? '(absent)'}` };
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics — pinned, content-free STDERR messages + a level-gated logger (design D4/D7)
// ─────────────────────────────────────────────────────────────────────────────

/** The pinned startup INFO line — always states the read-only, no-auth posture (design D7). */
export function httpStartupLine(host: string, port: number): string {
  return `dbgraph mcp: Streamable HTTP on http://${host}:${String(port)} (read-only, no auth)`;
}

/**
 * The pinned non-loopback WARNING (design D4) naming (a) the non-loopback exposure,
 * (b) the absence of authentication in v1, and (c) the reverse-proxy remedy.
 */
export const NON_LOOPBACK_WARNING =
  'WARNING: --host 0.0.0.0 exposes the dbgraph MCP endpoint on ALL interfaces with NO authentication. ' +
  'Anyone who can reach this host:port can call the read-only tools. ' +
  'Front it with a reverse proxy (TLS + auth) or restrict via network controls.';

/** Content-free session-initialized DEBUG line (uuid only — a session id is not a secret). */
export function sessionInitializedLine(sessionId: string): string {
  return `session initialized ${sessionId}`;
}

/** Content-free session-closed DEBUG line. */
export function sessionClosedLine(sessionId: string): string {
  return `session closed ${sessionId}`;
}

/** Log levels, low → high severity. */
export type McpLogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<McpLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** `--quiet`/`-q` → `warn` (suppresses startup INFO + per-session DEBUG); otherwise `debug`. */
export function resolveMcpLogLevel(quiet: boolean): McpLogLevel {
  return quiet ? 'warn' : 'debug';
}

/**
 * A tiny level-gated STDERR logger LOCAL to src/mcp (ADR-004 blocks importing src/cli/log).
 * Content-free: it writes only the message string, never the optional `meta`. The `write`
 * seam defaults to STDERR and is injectable for deterministic testing.
 */
export function createStderrLogger(
  level: McpLogLevel,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Logger {
  const enabled = (l: McpLogLevel): boolean => LEVEL_ORDER[l] >= LEVEL_ORDER[level];
  return {
    debug: (msg: string): void => {
      if (enabled('debug')) write(msg);
    },
    info: (msg: string): void => {
      if (enabled('info')) write(msg);
    },
    warn: (msg: string): void => {
      if (enabled('warn')) write(msg);
    },
    error: (msg: string): void => {
      if (enabled('error')) write(msg);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SessionRegistry — keyed live sessions + the graceful-drain primitive (design D2/D6)
// ─────────────────────────────────────────────────────────────────────────────

/** The Streamable HTTP transport surface the router + registry depend on (structural). */
export interface SessionTransport {
  handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void>;
  close(): Promise<void>;
}

/** A live session: its Streamable HTTP transport + the MCP Server bound to it. */
export interface SessionEntry {
  readonly transport: SessionTransport;
  readonly server: { close(): Promise<void> };
}

/**
 * In-memory registry of live sessions keyed by `mcp-session-id` (design D2). Its
 * {@link SessionRegistry.close} method is the graceful-drain primitive for D6: it closes
 * EVERY session's transport AND server, then empties the map.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionEntry>();

  /** Number of live sessions. */
  get size(): number {
    return this.sessions.size;
  }

  /** Registers a session under its id. */
  add(id: string, entry: SessionEntry): void {
    this.sessions.set(id, entry);
  }

  /** Returns the session entry for an id, or undefined. */
  get(id: string): SessionEntry | undefined {
    return this.sessions.get(id);
  }

  /** True when a session id is registered. */
  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** Removes a session id from the registry (does NOT close it — see onsessionclosed). */
  drop(id: string): void {
    this.sessions.delete(id);
  }

  /**
   * Drains ALL sessions: awaits `transport.close()` AND `server.close()` for every entry,
   * then empties the map. Safe to call on an empty registry.
   */
  async close(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(entries.flatMap((entry) => [entry.transport.close(), entry.server.close()]));
  }
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
 * Emits the startup diagnostics (design D4/D7): the pinned startup INFO line always, and
 * the pinned non-loopback WARNING when the bind host is not a loopback address. Pure over
 * the injected logger — exported so the warn-on-non-loopback decision is testable without
 * binding a non-loopback socket.
 */
export function emitStartupDiagnostics(logger: Logger, host: string, port: number): void {
  logger.info(httpStartupLine(host, port));
  if (!isLoopbackHostname(host)) {
    logger.warn(NON_LOOPBACK_WARNING);
  }
}

/** Sends a content-free JSON-RPC error response (mirrors the SDK's error shape). */
function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  const body = JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

/** Normalizes a possibly-multi-valued header to its first string value. */
function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads and JSON-parses the request body (design Batch-0 finding: the router PRE-PARSES
 * so it can gate new sessions on isInitializeRequest and produce the split 400/404, then
 * passes the parsed body to `handleRequest`). Resolves undefined for an empty body.
 */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
    });
    req.on('end', () => {
      if (data.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err: unknown) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', reject);
  });
}

/** Per-listener context for the request router. */
interface RouterContext {
  readonly bindHost: string;
  readonly port: number;
  readonly registry: SessionRegistry;
  readonly createServer: (store?: GraphStore) => Server;
  readonly logger: Logger;
}

/**
 * Routes one HTTP request (design D2/D3/D6 + the Batch-0 recipe):
 * 1. validateOriginHost → 403 Forbidden BEFORE any tool handler.
 * 2. POST with a known `mcp-session-id` → route to that session's transport.
 * 3. POST with NO id + isInitializeRequest → mint transport + Server + connect, register.
 * 4. POST with an unknown/terminated id → 404 `Session not found`.
 * 5. POST with NO id + non-init → 400 `No valid session ID provided`.
 * 6. GET/DELETE with a known id → route to the transport (SDK handles DELETE → 200 + onsessionclosed).
 */
async function routeHttpRequest(req: IncomingMessage, res: ServerResponse, ctx: RouterContext): Promise<void> {
  // D3: Origin/Host validation runs FIRST — a rejection never reaches a tool handler.
  const decision = validateOriginHost({
    headers: { host: req.headers.host, origin: headerString(req.headers.origin) },
    bindHost: ctx.bindHost,
    port: ctx.port,
  });
  if (!decision.ok) {
    sendJsonRpcError(res, 403, -32000, 'Forbidden');
    return;
  }

  const sessionId = headerString(req.headers['mcp-session-id']);

  if (req.method === 'POST') {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJsonRpcError(res, 400, -32700, 'Parse error');
      return;
    }

    const existing = sessionId === undefined ? undefined : ctx.registry.get(sessionId);
    if (existing !== undefined) {
      await existing.transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId === undefined && isInitializeRequest(body)) {
      const server = ctx.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string): void => {
          ctx.registry.add(id, { transport, server });
          ctx.logger.debug(sessionInitializedLine(id));
        },
        onsessionclosed: (id: string): void => {
          ctx.registry.drop(id);
          ctx.logger.debug(sessionClosedLine(id));
          void server.close();
        },
      });
      // Cast bridges an exactOptionalPropertyTypes variance in the SDK: the transport's
      // `onclose` is `(() => void) | undefined` while Transport declares `onclose?`. The
      // StreamableHTTPServerTransport IS a valid Transport at runtime.
      await server.connect(transport as unknown as Parameters<Server['connect']>[0]);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId !== undefined) {
      // Present but not registered → unknown or already-terminated (Batch-0 finding: the
      // SDK would return 400 on a fresh transport, so the router emits the spec's 404).
      sendJsonRpcError(res, 404, -32001, 'Session not found');
      return;
    }

    sendJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided');
    return;
  }

  // GET (SSE) or DELETE — route to the addressed session; unknown id → 404.
  const entry = sessionId === undefined ? undefined : ctx.registry.get(sessionId);
  if (entry !== undefined) {
    await entry.transport.handleRequest(req, res);
    return;
  }
  sendJsonRpcError(res, 404, -32001, 'Session not found');
}

/**
 * Starts the Streamable HTTP MCP listener (design D2/D3/D4/D6/D7). Binds `opts.host`:`opts.port`
 * (default loopback), routes per-session `StreamableHTTPServerTransport` instances built over
 * `deps.createServer` (defaults to `createDbgraphServer`), enforces the in-house Origin/Host
 * check, and installs SIGINT/SIGTERM → graceful drain. Returns `{ port, close() }`.
 */
export function startHttpMcpServer(
  opts: StartHttpMcpServerOptions,
  deps: StartHttpMcpServerDeps = {},
): Promise<HttpMcpServerHandle> {
  const { host, port } = opts;
  const quiet = opts.quiet ?? false;
  const logger = opts.logger ?? createStderrLogger(resolveMcpLogLevel(quiet));
  const createServer = deps.createServer ?? createDbgraphServer;
  const registry = new SessionRegistry();

  const httpServer = createHttpServer((req, res) => {
    void routeHttpRequest(req, res, { bindHost: host, port, registry, createServer, logger }).catch(() => {
      // Content-free: never surface schema/object names, connection strings, or secrets.
      logger.error('internal error handling MCP HTTP request');
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, 'Internal server error');
      }
    });
  });

  return new Promise<HttpMcpServerHandle>((resolve, reject) => {
    const onListenError = (err: Error): void => {
      reject(err);
    };
    httpServer.once('error', onListenError);

    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', onListenError);

      const address = httpServer.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;

      emitStartupDiagnostics(logger, host, boundPort);

      let closed = false;
      const close = async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        // Stop accepting, then drain every open session's transport + server (design D6).
        await new Promise<void>((resolveClose) => {
          httpServer.close(() => {
            resolveClose();
          });
        });
        await registry.close();
      };
      const onSignal = (): void => {
        void close();
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);

      resolve({ port: boundPort, close });
    });
  });
}
