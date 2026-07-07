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

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import {
  parseMcpFlags,
  validateOriginHost,
  SessionRegistry,
  httpStartupLine,
  NON_LOOPBACK_WARNING,
  sessionInitializedLine,
  sessionClosedLine,
  resolveMcpLogLevel,
  createStderrLogger,
  emitStartupDiagnostics,
  startHttpMcpServer,
  type HttpMcpServerHandle,
} from '../../src/mcp/http.js';
import { ConfigError, type Logger, type GraphStore } from '../../src/index.js';
import { planEntry } from '../../src/bin/sea-entry.js';
import { createDbgraphServer, runMcpBin } from '../../src/mcp/server.js';
import { createHarness, type McpTestHarness } from './harness.js';
import { openFixtureStore, type FixtureStore } from './fixture.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// validateOriginHost — in-house DNS-rebinding defense (task 2.1, design D3). PURE.
// NOT the deprecated SDK allowedHosts/allowedOrigins/enableDnsRebindingProtection.
// Origin absent → allow (header-less agents); present → allow only loopback origins.
// Host on a loopback bind → allow only {127.0.0.1, localhost, [::1]}(:port). On a
// 0.0.0.0 bind the Host check is RELAXED but Origin rejection STAYS ON.
// ─────────────────────────────────────────────────────────────────────────────

describe('validateOriginHost — pure Origin/Host allowlist (task 2.1, design D3)', () => {
  const PORT = 7423;
  const LOOPBACK = '127.0.0.1';

  it('no Origin + loopback Host → ok (header-less agents allowed)', () => {
    expect(validateOriginHost({ headers: { host: '127.0.0.1:7423' }, bindHost: LOOPBACK, port: PORT })).toStrictEqual({
      ok: true,
    });
  });

  it.each([
    'http://localhost',
    'http://localhost:7423',
    'http://127.0.0.1',
    'http://127.0.0.1:7423',
    'http://[::1]',
    'http://[::1]:7423',
  ])('loopback Origin %s → ok', (origin) => {
    expect(
      validateOriginHost({ headers: { host: '127.0.0.1:7423', origin }, bindHost: LOOPBACK, port: PORT }),
    ).toStrictEqual({ ok: true });
  });

  it('foreign Origin → 403 (rejected before any tool)', () => {
    const result = validateOriginHost({
      headers: { host: '127.0.0.1:7423', origin: 'http://evil.example.com' },
      bindHost: LOOPBACK,
      port: PORT,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(403);
      expect(typeof result.reason).toBe('string');
    }
  });

  it('malformed Origin → 403 (cannot confirm loopback)', () => {
    const result = validateOriginHost({
      headers: { host: '127.0.0.1:7423', origin: 'not a url' },
      bindHost: LOOPBACK,
      port: PORT,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(403);
  });

  it.each(['127.0.0.1', '127.0.0.1:7423', 'localhost', 'localhost:7423', '[::1]', '[::1]:7423'])(
    'loopback Host %s on a loopback bind → ok',
    (host) => {
      expect(validateOriginHost({ headers: { host }, bindHost: LOOPBACK, port: PORT })).toStrictEqual({ ok: true });
    },
  );

  it('foreign Host on a loopback bind → 403 (DNS-rebinding defense)', () => {
    const result = validateOriginHost({ headers: { host: 'evil.example.com' }, bindHost: LOOPBACK, port: PORT });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(403);
  });

  it('absent Host on a loopback bind → 403 (cannot confirm loopback)', () => {
    const result = validateOriginHost({ headers: {}, bindHost: LOOPBACK, port: PORT });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(403);
  });

  it('0.0.0.0 bind RELAXES the Host check — a foreign Host is allowed when Origin is absent', () => {
    expect(validateOriginHost({ headers: { host: 'my-lan-box.internal:7423' }, bindHost: '0.0.0.0', port: PORT })).toStrictEqual({
      ok: true,
    });
  });

  it('0.0.0.0 bind KEEPS Origin rejection — a foreign Origin is still 403', () => {
    const result = validateOriginHost({
      headers: { host: 'my-lan-box.internal:7423', origin: 'http://evil.example.com' },
      bindHost: '0.0.0.0',
      port: PORT,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(403);
  });

  it('0.0.0.0 bind + loopback Origin → ok (Origin allowlist still applies, permissively)', () => {
    expect(
      validateOriginHost({ headers: { host: 'anything', origin: 'http://localhost:7423' }, bindHost: '0.0.0.0', port: PORT }),
    ).toStrictEqual({ ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionRegistry — Map<sessionId,{transport,server}> + drain (task 2.2, design D2/D6).
// The drain primitive for graceful shutdown: close() awaits transport.close() AND
// server.close() for EVERY entry, then empties the map.
// ─────────────────────────────────────────────────────────────────────────────

function makeFakeEntry() {
  return {
    transport: { handleRequest: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    server: { close: vi.fn(async () => undefined) },
  };
}

describe('SessionRegistry — add/get/drop/size + drain (task 2.2, design D2/D6)', () => {
  it('starts empty', () => {
    expect(new SessionRegistry().size).toBe(0);
  });

  it('add → get returns the same entry; has reports membership; size increments', () => {
    const registry = new SessionRegistry();
    const entry = makeFakeEntry();
    registry.add('sid-1', entry);
    expect(registry.size).toBe(1);
    expect(registry.get('sid-1')).toBe(entry);
    expect(registry.has('sid-1')).toBe(true);
  });

  it('get(unknown) → undefined; has(unknown) → false', () => {
    const registry = new SessionRegistry();
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('nope')).toBe(false);
  });

  it('drop removes the entry and decrements size', () => {
    const registry = new SessionRegistry();
    registry.add('sid-1', makeFakeEntry());
    registry.drop('sid-1');
    expect(registry.size).toBe(0);
    expect(registry.get('sid-1')).toBeUndefined();
  });

  it('close() drains EVERY entry — awaits transport.close() AND server.close() — then empties the map', async () => {
    const registry = new SessionRegistry();
    const a = makeFakeEntry();
    const b = makeFakeEntry();
    registry.add('a', a);
    registry.add('b', b);

    await registry.close();

    expect(a.transport.close).toHaveBeenCalledTimes(1);
    expect(a.server.close).toHaveBeenCalledTimes(1);
    expect(b.transport.close).toHaveBeenCalledTimes(1);
    expect(b.server.close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('close() on an empty registry is a no-op that resolves', async () => {
    await expect(new SessionRegistry().close()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STDERR Logger default + pinned message goldens (task 2.3, design D4/D7).
// startup INFO, the D4 non-loopback WARN, content-free session DEBUG, --quiet → warn.
// Diagnostics MUST leak no schema/object name, connection string, or resolved secret.
// ─────────────────────────────────────────────────────────────────────────────

describe('HTTP diagnostics — pinned message goldens (task 2.3, design D4/D7)', () => {
  it('startup INFO line is byte-pinned', () => {
    expect(httpStartupLine('127.0.0.1', 7423)).toBe(
      'dbgraph mcp: Streamable HTTP on http://127.0.0.1:7423 (read-only, no auth)',
    );
  });

  it('startup line always states the no-auth posture (regardless of bind)', () => {
    expect(httpStartupLine('0.0.0.0', 8080)).toBe(
      'dbgraph mcp: Streamable HTTP on http://0.0.0.0:8080 (read-only, no auth)',
    );
    expect(httpStartupLine('0.0.0.0', 8080)).toContain('no auth');
  });

  it('the D4 non-loopback WARNING names (a) non-loopback exposure, (b) no auth in v1, (c) reverse-proxy remedy', () => {
    expect(NON_LOOPBACK_WARNING).toBe(
      'WARNING: --host 0.0.0.0 exposes the dbgraph MCP endpoint on ALL interfaces with NO authentication. ' +
        'Anyone who can reach this host:port can call the read-only tools. ' +
        'Front it with a reverse proxy (TLS + auth) or restrict via network controls.',
    );
    expect(NON_LOOPBACK_WARNING).toContain('ALL interfaces'); // (a)
    expect(NON_LOOPBACK_WARNING).toContain('NO authentication'); // (b)
    expect(NON_LOOPBACK_WARNING).toContain('reverse proxy'); // (c)
  });

  it('session DEBUG lines are content-free (uuid only)', () => {
    const uuid = '9d47d230-8d4a-4050-b0f0-5a4693e05e36';
    expect(sessionInitializedLine(uuid)).toBe(`session initialized ${uuid}`);
    expect(sessionClosedLine(uuid)).toBe(`session closed ${uuid}`);
  });

  it('--quiet/-q resolves to level "warn"; otherwise "debug"', () => {
    expect(resolveMcpLogLevel(true)).toBe('warn');
    expect(resolveMcpLogLevel(false)).toBe('debug');
  });

  it('default (non-quiet, level debug) logger emits startup INFO + session DEBUG + WARN + error', () => {
    const lines: string[] = [];
    const logger = createStderrLogger('debug', (l) => lines.push(l));
    logger.info(httpStartupLine('127.0.0.1', 7423));
    logger.debug(sessionInitializedLine('u1'));
    logger.warn(NON_LOOPBACK_WARNING);
    logger.error('boom');
    expect(lines).toStrictEqual([
      'dbgraph mcp: Streamable HTTP on http://127.0.0.1:7423 (read-only, no auth)',
      'session initialized u1',
      NON_LOOPBACK_WARNING,
      'boom',
    ]);
  });

  it('--quiet (level warn) SUPPRESSES startup + session lines but KEEPS the WARN + errors', () => {
    const lines: string[] = [];
    const logger = createStderrLogger('warn', (l) => lines.push(l));
    logger.info(httpStartupLine('127.0.0.1', 7423)); // suppressed
    logger.debug(sessionInitializedLine('u1')); // suppressed
    logger.warn(NON_LOOPBACK_WARNING); // kept
    logger.error('boom'); // kept
    expect(lines).toStrictEqual([NON_LOOPBACK_WARNING, 'boom']);
  });

  it('diagnostics leak NO schema/object name, connection string, or resolved secret', () => {
    // Neutral fixture surface — none of these must appear in any pinned line.
    const secrets = ['orders', 'customers', 'acme_billing', 'Server=db;Password=hunter2', 'hunter2', 's3cr3t-token'];
    const lines = [
      httpStartupLine('127.0.0.1', 7423),
      httpStartupLine('0.0.0.0', 8080),
      NON_LOOPBACK_WARNING,
      sessionInitializedLine('9d47d230-8d4a-4050-b0f0-5a4693e05e36'),
      sessionClosedLine('9d47d230-8d4a-4050-b0f0-5a4693e05e36'),
    ];
    for (const line of lines) {
      for (const secret of secrets) {
        expect(line).not.toContain(secret);
      }
    }
  });

  it('emitStartupDiagnostics: loopback bind → INFO only (no WARN)', () => {
    const lines: string[] = [];
    const logger = createStderrLogger('debug', (l) => lines.push(l));
    emitStartupDiagnostics(logger, '127.0.0.1', 7423);
    expect(lines).toStrictEqual(['dbgraph mcp: Streamable HTTP on http://127.0.0.1:7423 (read-only, no auth)']);
  });

  it('emitStartupDiagnostics: non-loopback (0.0.0.0) bind → INFO + the pinned WARN', () => {
    const lines: string[] = [];
    const logger = createStderrLogger('debug', (l) => lines.push(l));
    emitStartupDiagnostics(logger, '0.0.0.0', 8080);
    expect(lines).toStrictEqual([
      'dbgraph mcp: Streamable HTTP on http://0.0.0.0:8080 (read-only, no auth)',
      NON_LOOPBACK_WARNING,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startHttpMcpServer — node:http listener + per-session router (task 2.4, design
// D2/D3/D6/D7 + Batch-0 recipe). Bound to loopback 127.0.0.1:0 (ephemeral) with an
// INJECTED minimal createServer fixture — NO DB, NO network beyond loopback.
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal SDK Server (stand-in for createDbgraphServer) exposing one tool. */
function makeTinyServer(): Server {
  const server = new Server({ name: 'tiny', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object' } }],
  }));
  return server;
}

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = createStderrLogger('debug', (l) => lines.push(l));
  return { logger, lines };
}

const INIT_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
} as const;
const LIST_BODY = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } as const;
const MCP_ACCEPT = 'application/json, text/event-stream';

async function rpc(
  port: number,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; sid: string | null; text: string }> {
  const res = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
    method,
    headers: { 'content-type': 'application/json', accept: MCP_ACCEPT, ...headers },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, sid: res.headers.get('mcp-session-id'), text };
}

describe('startHttpMcpServer — listener + router over loopback (task 2.4, design D2/D3/D6/D7)', () => {
  let handle: { port: number; close(): Promise<void> } | undefined;

  afterEach(async () => {
    if (handle !== undefined) {
      await handle.close();
      handle = undefined;
    }
  });

  it('binds an ephemeral loopback port and logs the startup INFO line (no WARN)', async () => {
    const { logger, lines } = captureLogger();
    handle = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });
    expect(handle.port).toBeGreaterThan(0);
    expect(lines).toContain('dbgraph mcp: Streamable HTTP on http://127.0.0.1:' + String(handle.port) + ' (read-only, no auth)');
    expect(lines).not.toContain(NON_LOOPBACK_WARNING);
  });

  it('initialize issues a session id; a follow-up with that id lists the injected tool', async () => {
    const { logger, lines } = captureLogger();
    handle = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });

    const init = await rpc(handle.port, 'POST', INIT_BODY);
    expect(init.status).toBe(200);
    expect(init.sid).toBeTruthy();
    const sid = init.sid as string;
    expect(lines).toContain(sessionInitializedLine(sid));

    const list = await rpc(handle.port, 'POST', LIST_BODY, { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18' });
    expect(list.status).toBe(200);
    expect(list.text).toContain('ping');
  });

  it('a non-initialize POST with NO session id → HTTP 400 (no tool handler runs)', async () => {
    const { logger } = captureLogger();
    handle = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });
    const r = await rpc(handle.port, 'POST', LIST_BODY);
    expect(r.status).toBe(400);
    expect(r.text).toContain('-32000');
  });

  it('a request bearing an UNKNOWN session id → HTTP 404 Session not found', async () => {
    const { logger } = captureLogger();
    handle = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });
    const r = await rpc(handle.port, 'POST', LIST_BODY, {
      'mcp-session-id': 'unknown-0000-0000-0000-000000000000',
      'mcp-protocol-version': '2025-06-18',
    });
    expect(r.status).toBe(404);
    expect(r.text).toContain('Session not found');
  });

  it('a foreign Origin is rejected with HTTP 403 Forbidden BEFORE any session routing', async () => {
    // NOTE: fetch/undici forbids overriding the Host header (derived from the URL authority),
    // so the DNS-rebinding vector is exercised via a foreign Origin — the primary check (D3).
    const { logger } = captureLogger();
    handle = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });
    const r = await rpc(handle.port, 'POST', INIT_BODY, { origin: 'http://evil.example.com' });
    expect(r.status).toBe(403);
    expect(r.text).toContain('Forbidden');
    expect(r.text).toContain('-32000');
  });

  it('DELETE terminates the session; a later request with that id → HTTP 404', async () => {
    const { logger, lines } = captureLogger();
    handle = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });

    const init = await rpc(handle.port, 'POST', INIT_BODY);
    const sid = init.sid as string;

    const del = await rpc(handle.port, 'DELETE', undefined, { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18' });
    expect(del.status).toBe(200);
    expect(lines).toContain(sessionClosedLine(sid));

    const after = await rpc(handle.port, 'POST', LIST_BODY, { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18' });
    expect(after.status).toBe(404);
  });

  it('close() drains and stops accepting — a later request is refused', async () => {
    const { logger } = captureLogger();
    const h = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });
    const { port } = h;
    await rpc(port, 'POST', INIT_BODY); // one open session

    await expect(h.close()).resolves.toBeUndefined();
    handle = undefined; // already closed

    await expect(rpc(port, 'POST', INIT_BODY)).rejects.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Batch 3 — in-process loopback E2E over the SQLite torture fixture (tasks 3.1–3.4).
//
// Drives the REAL startHttpMcpServer (B2) with createServer =
// () => createDbgraphServer(fx.store) — the SAME factory + store the STDIO harness
// uses — so cross-transport byte-identity (3.3) is a genuine parity lock, not a
// re-render. NO Docker, NO network beyond loopback (127.0.0.1, ephemeral port 0),
// deterministic. Responses arrive as SSE `data:` frames (SDK default,
// enableJsonResponse=false — design §"Batch 0"); parseSse() extracts the JSON-RPC
// message the SDK Client would otherwise decode transparently.
// ═════════════════════════════════════════════════════════════════════════════

const goldenDir = resolve(dirname(fileURLToPath(import.meta.url)), 'golden');

/** The JSON-RPC message shape the E2E assertions read out of an SSE frame. */
interface RpcMessage {
  readonly result?: {
    readonly tools?: readonly { readonly name: string }[];
    readonly content?: readonly { readonly type: string; readonly text: string }[];
    readonly instructions?: string;
  };
  readonly error?: { readonly code: number; readonly message: string };
}

/** Extracts the JSON-RPC message from an SSE `data:` frame (the SDK's default framing). */
function parseSse(text: string): RpcMessage {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s?/, ''))
    .join('\n');
  if (data.length === 0) {
    throw new Error(`no SSE data frame in response: ${JSON.stringify(text)}`);
  }
  return JSON.parse(data) as RpcMessage;
}

/** Pulls the first text content block out of a tools/call result. */
function toolText(msg: RpcMessage): string {
  const text = msg.result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`no tool text in result: ${JSON.stringify(msg)}`);
  }
  return text;
}

const CALL_BODY = (name: string, args: Record<string, unknown>, id: number): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

/** Session-routing headers for a follow-up request. */
const SID_HEADERS = (sid: string): Record<string, string> => ({
  'mcp-session-id': sid,
  'mcp-protocol-version': '2025-06-18',
});

/** GraphStore mutators (ADR-008: HTTP tool calls must NEVER reach these). */
const GRAPH_STORE_WRITE_METHODS: ReadonlySet<string> = new Set([
  'upsertGraph',
  'deleteNodes',
  'putSnapshot',
  'setMeta',
]);

/**
 * Wraps a GraphStore in a recording proxy that logs every method call, classified
 * as a write (a mutator — must stay EMPTY) or a read. Proves HTTP tool handlers
 * issue read-only catalog access (task 3.4). `close` is excluded (lifecycle, not I/O).
 */
function recordingReadOnlyStore(store: GraphStore): { store: GraphStore; writes: string[]; reads: string[] } {
  const writes: string[] = [];
  const reads: string[] = [];
  const proxy = new Proxy(store, {
    get(target, prop, receiver): unknown {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') {
        return value;
      }
      const name = String(prop);
      const fn = value as (...fnArgs: unknown[]) => unknown;
      return (...fnArgs: unknown[]): unknown => {
        if (GRAPH_STORE_WRITE_METHODS.has(name)) {
          writes.push(name);
        } else if (name !== 'close') {
          reads.push(name);
        }
        return fn.apply(target, fnArgs);
      };
    },
  });
  return { store: proxy as GraphStore, writes, reads };
}

describe('Batch 3 — loopback E2E over the SQLite torture fixture (tasks 3.1–3.4)', () => {
  let fx: FixtureStore;
  let sharedHttp: HttpMcpServerHandle;
  let stdioHarness: McpTestHarness;

  beforeAll(async () => {
    fx = await openFixtureStore();
    const { logger } = captureLogger();
    sharedHttp = await startHttpMcpServer(
      { host: '127.0.0.1', port: 0, logger },
      { createServer: () => createDbgraphServer(fx.store) },
    );
    // The STDIO side of the parity lock: the SAME factory + store over InMemoryTransport.
    stdioHarness = await createHarness(createDbgraphServer(fx.store));
  }, 60_000);

  afterAll(async () => {
    await sharedHttp.close();
    await stdioHarness.close();
    await fx.cleanup();
  });

  // ── 3.1 — full session lifecycle over real HTTP ─────────────────────────────
  describe('session lifecycle over real HTTP (task 3.1)', () => {
    it('init→200+sid, tools/list→exactly 8 tools, tools/call→result, DELETE→200, terminated id→404, missing id→400', async () => {
      const init = await rpc(sharedHttp.port, 'POST', INIT_BODY);
      expect(init.status).toBe(200);
      expect(init.sid).toBeTruthy();
      const sid = init.sid as string;

      const list = await rpc(sharedHttp.port, 'POST', LIST_BODY, SID_HEADERS(sid));
      expect(list.status).toBe(200);
      const names = (parseSse(list.text).result?.tools ?? []).map((t) => t.name).sort();
      expect(names).toStrictEqual([...EXPECTED_TOOL_NAMES].sort());

      const call = await rpc(sharedHttp.port, 'POST', CALL_BODY('dbgraph_status', {}, 3), SID_HEADERS(sid));
      expect(call.status).toBe(200);
      expect(toolText(parseSse(call.text))).toContain('DBGRAPH STATUS');

      const del = await rpc(sharedHttp.port, 'DELETE', undefined, SID_HEADERS(sid));
      expect(del.status).toBe(200);

      // Terminated id → 404 (router-emitted; never reaches a tool handler).
      const afterDelete = await rpc(sharedHttp.port, 'POST', LIST_BODY, SID_HEADERS(sid));
      expect(afterDelete.status).toBe(404);
      expect(afterDelete.text).toContain('Session not found');

      // Non-init request with NO session id → 400 (router-emitted; no tool handler).
      const missing = await rpc(sharedHttp.port, 'POST', LIST_BODY);
      expect(missing.status).toBe(400);
      expect(missing.text).toContain('-32000');
    });

    it('an UNKNOWN session id → 404 Session not found (no tool handler runs)', async () => {
      const r = await rpc(sharedHttp.port, 'POST', LIST_BODY, {
        'mcp-session-id': '00000000-0000-0000-0000-000000000000',
        'mcp-protocol-version': '2025-06-18',
      });
      expect(r.status).toBe(404);
      expect(r.text).toContain('Session not found');
    });
  });

  // ── 3.2 — foreign Origin/Host → 403 BEFORE any tool handler ─────────────────
  describe('Origin/Host 403 rejection before any tool handler (task 3.2, design D3)', () => {
    it('foreign Origin → 403 -32000 Forbidden before a session/server is ever created; loopback proceeds', async () => {
      let serversCreated = 0;
      const { logger } = captureLogger();
      const h = await startHttpMcpServer(
        { host: '127.0.0.1', port: 0, logger },
        {
          createServer: (): Server => {
            serversCreated += 1;
            return createDbgraphServer(fx.store);
          },
        },
      );
      try {
        const rejected = await rpc(h.port, 'POST', INIT_BODY, { origin: 'http://evil.example.com' });
        expect(rejected.status).toBe(403);
        const body: unknown = JSON.parse(rejected.text);
        expect(body).toStrictEqual({ jsonrpc: '2.0', error: { code: -32000, message: 'Forbidden' }, id: null });
        // The 403 short-circuits BEFORE session creation → no Server, hence no tool handler, was reached.
        expect(serversCreated).toBe(0);

        // An allowed loopback Origin proceeds to session routing normally (a server IS minted).
        const allowed = await rpc(h.port, 'POST', INIT_BODY, { origin: 'http://localhost' });
        expect(allowed.status).toBe(200);
        expect(allowed.sid).toBeTruthy();
        expect(serversCreated).toBe(1);
      } finally {
        await h.close();
      }
    });
  });

  // ── 3.3 — cross-transport byte-identity (ADR-008) ───────────────────────────
  describe('cross-transport byte-identity (task 3.3, ADR-008)', () => {
    // NOTE: the committed golden `explore-brief.txt` was captured from `main.employees`
    // (the security-neutralized torture fixture has no `orders` table — the `orders` in
    // the spec/tool-description text is an illustrative example). The parity contract is
    // identical: HTTP == STDIO == the explore×brief golden, driven from ONE factory.
    it('dbgraph_explore(main.employees, brief): HTTP == STDIO == the explore×brief golden', async () => {
      const args = { target: 'main.employees', detail: 'brief' } as const;

      const stdioText = await stdioHarness.callTool('dbgraph_explore', { ...args });

      const sid = (await rpc(sharedHttp.port, 'POST', INIT_BODY)).sid as string;
      const call = await rpc(sharedHttp.port, 'POST', CALL_BODY('dbgraph_explore', { ...args }, 20), SID_HEADERS(sid));
      expect(call.status).toBe(200);
      const httpText = toolText(parseSse(call.text));

      // Byte-identical across transports (no transport-specific rendering).
      expect(httpText).toBe(stdioText);

      // And both match the committed golden (ADR-008 determinism).
      const golden = readFileSync(join(goldenDir, 'explore-brief.txt'), 'utf-8');
      expect(httpText).toBe(golden);
      expect(stdioText).toBe(golden);
    });

    it('the static initialize instructions are identical across transports and match the golden', async () => {
      const init = await rpc(sharedHttp.port, 'POST', INIT_BODY);
      const httpInstructions = parseSse(init.text).result?.instructions;
      const stdioInstructions = stdioHarness.client.getInstructions();

      expect(httpInstructions).toBe(stdioInstructions);
      const golden = readFileSync(join(goldenDir, 'instructions.txt'), 'utf-8');
      expect(httpInstructions).toBe(golden);
    });

    it('both transports expose the identical 8-tool surface from one createDbgraphServer factory', async () => {
      const stdioNames = (await stdioHarness.client.listTools()).tools.map((t) => t.name).sort();

      const sid = (await rpc(sharedHttp.port, 'POST', INIT_BODY)).sid as string;
      const list = await rpc(sharedHttp.port, 'POST', LIST_BODY, SID_HEADERS(sid));
      const httpNames = (parseSse(list.text).result?.tools ?? []).map((t) => t.name).sort();

      expect(httpNames).toStrictEqual([...EXPECTED_TOOL_NAMES].sort());
      expect(httpNames).toStrictEqual(stdioNames);
    });
  });

  // ── 3.4 — read-only preservation, content-free diagnostics, graceful drain ──
  describe('read-only, content-free diagnostics, graceful drain (task 3.4, design D2/D6/D7)', () => {
    it('HTTP tool calls issue ONLY reads — no GraphStore mutator is invoked; diagnostics are content-free', async () => {
      const rec = recordingReadOnlyStore(fx.store);
      const { logger, lines } = captureLogger();
      const h = await startHttpMcpServer(
        { host: '127.0.0.1', port: 0, logger },
        { createServer: () => createDbgraphServer(rec.store) },
      );
      try {
        const sid = (await rpc(h.port, 'POST', INIT_BODY)).sid as string;
        await rpc(h.port, 'POST', CALL_BODY('dbgraph_explore', { target: 'main.employees', detail: 'full' }, 30), SID_HEADERS(sid));
        await rpc(h.port, 'POST', CALL_BODY('dbgraph_search', { query: 'employees' }, 31), SID_HEADERS(sid));
        await rpc(h.port, 'POST', CALL_BODY('dbgraph_status', {}, 32), SID_HEADERS(sid));

        // Read-only: zero mutators, and the reads array proves the tools actually ran (not a ghost pass).
        expect(rec.writes).toStrictEqual([]);
        expect(rec.reads.length).toBeGreaterThan(0);

        // Content-free diagnostics: no schema/object name, no connection string, no secret.
        const diagnostics = lines.join('\n');
        for (const objectName of ['employees', 'departments', 'projects', 'customers', 'orders']) {
          expect(diagnostics).not.toContain(objectName);
        }
        expect(diagnostics).not.toMatch(/password|secret|token|Server=|Data Source=/i);
      } finally {
        await h.close();
      }
    });

    it('SIGINT/SIGTERM are wired to a graceful drain that closes every session + the listener, leaving no dangling handles', async () => {
      const sigintBefore = process.listenerCount('SIGINT');
      const sigtermBefore = process.listenerCount('SIGTERM');

      // Track that each open session's Server is closed on drain. (transport.close() is
      // covered by the SessionRegistry unit — task 2.2 — which closes BOTH per entry.)
      let sessionServerCloses = 0;
      const trackingFactory = (): Server => {
        const server = createDbgraphServer(fx.store);
        const originalClose = server.close.bind(server);
        server.close = async (): Promise<void> => {
          sessionServerCloses += 1;
          await originalClose();
        };
        return server;
      };

      const { logger } = captureLogger();
      const h = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: trackingFactory });

      // Wiring: start installs exactly one SIGINT AND one SIGTERM handler (both signals covered).
      expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore + 1);

      // Open ≥1 session so the drain has a live session to close.
      const init = await rpc(h.port, 'POST', INIT_BODY);
      expect(init.status).toBe(200);
      expect(sessionServerCloses).toBe(0);

      // Graceful drain — the EXACT function both signal handlers delegate to. Driving
      // close() directly (rather than emitting a real process signal, which would race
      // the test runner) is faithful: the SIGINT/SIGTERM handlers do nothing else.
      await h.close();

      // Every open session's Server was closed (drain).
      expect(sessionServerCloses).toBe(1);
      // Listener stopped accepting and closed → a later request is refused.
      await expect(rpc(h.port, 'POST', INIT_BODY)).rejects.toBeDefined();
      // No dangling handles: close() removed both signal listeners.
      expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
    });

    it('close() drains promptly while a client holds the GET SSE notification stream open (verify R1)', async () => {
      // WARNING-1 + CRITICAL-1 regression. The drain test above exercises a POST-only
      // session, so it never opens the NORMATIVE Streamable-HTTP GET SSE notification
      // stream — the exact connection that made close() deadlock. Here we OPEN and HOLD
      // that stream, then require close() to resolve promptly. Pre-fix this HANGS (>2000ms)
      // because httpServer.close() awaited the still-open GET connection BEFORE
      // registry.close() ended it. A 2000ms race guard turns a regression into a clean
      // assertion failure rather than a 15s runner-level hang.
      const { logger } = captureLogger();
      const h = await startHttpMcpServer({ host: '127.0.0.1', port: 0, logger }, { createServer: makeTinyServer });
      const { port } = h;

      const init = await rpc(port, 'POST', INIT_BODY);
      expect(init.status).toBe(200);
      const sid = init.sid as string;

      // Open the standalone GET SSE stream (the SDK Client opens this for server→client
      // notifications) and hold it — start a read that never completes, mirroring a real
      // streaming agent keeping the channel open.
      const controller = new AbortController();
      const sse = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
        method: 'GET',
        headers: { accept: 'text/event-stream', ...SID_HEADERS(sid) },
        signal: controller.signal,
      });
      expect(sse.status).toBe(200);
      const reader = sse.body?.getReader();
      const pendingRead = reader?.read().catch(() => undefined);

      // The heart of the test: close() must drain the transport (ending the in-flight GET
      // response) and resolve — it must NOT block on the held connection first.
      const outcome = await Promise.race([
        h.close().then(() => 'closed' as const),
        new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), 2000);
        }),
      ]);

      // Release the client side regardless of outcome so no socket lingers.
      controller.abort();
      await pendingRead;

      expect(outcome).toBe('closed');

      // Listener stopped accepting → a later request is refused.
      await expect(rpc(port, 'POST', INIT_BODY)).rejects.toBeDefined();
    });
  });
});
