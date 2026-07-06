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

import { describe, it, expect, vi, afterEach } from 'vitest';

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
} from '../../src/mcp/http.js';
import { ConfigError, type Logger } from '../../src/index.js';
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
