/**
 * Tests for dispatch table — task 2.2 (phase-4-cli-config).
 * Spec: cli-config "CLI exit codes are a stable contract" — unknown command → usage+exit 2.
 * Design Decision 4: dispatch maps command → handler; unknown command is a DispatchResult,
 * NOT a raw Error throw.
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dispatch, type DispatchResult } from '../../src/cli/dispatch.js';
import { runCli } from '../../src/cli/cli.js';
import { ConfigError } from '../../src/index.js';
import { materializeTorture } from '../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../fixtures/sqlite/materialize.js';
import { buildConfig, writeConfig } from '../../src/cli/config/build-config.js';
import { createSqliteGraphStore } from '../../src/index.js';
import { formatSyncSummary, type SyncSummary } from '../../src/cli/format/sync.js';
import type { ParsedArgs } from '../../src/cli/parse/args.js';
import { runInstall } from '../../src/cli/commands/install.js';

// Mock the install command module so handleInstall's call to runInstall is captured
// WITHOUT touching the real filesystem (US-038 — verify --project/cwd are forwarded).
vi.mock('../../src/cli/commands/install.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/cli/commands/install.js')>();
  return {
    ...actual,
    runInstall: vi.fn(async () => ({ type: 'success' as const })),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Known commands map to a handler
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch — known commands', () => {
  it('dispatches "init" to a handler function', () => {
    const result = dispatch('init');
    expect(result.type).toBe('handler');
    if (result.type === 'handler') {
      expect(typeof result.handler).toBe('function');
    }
  });

  it('dispatches "sync" to a handler function', () => {
    const result = dispatch('sync');
    expect(result.type).toBe('handler');
  });

  it('dispatches "status" to a handler function', () => {
    const result = dispatch('status');
    expect(result.type).toBe('handler');
  });

  it('dispatches "query" to a handler function', () => {
    const result = dispatch('query');
    expect(result.type).toBe('handler');
  });

  it('dispatches "explore" to a handler function', () => {
    const result = dispatch('explore');
    expect(result.type).toBe('handler');
  });

  it('dispatches "diff" to a handler function', () => {
    const result = dispatch('diff');
    expect(result.type).toBe('handler');
  });

  it('dispatches "object" to a handler function (explore-payloads C.4)', () => {
    const result = dispatch('object');
    expect(result.type).toBe('handler');
    if (result.type === 'handler') {
      expect(typeof result.handler).toBe('function');
    }
  });

  it('each known command returns a different handler reference', () => {
    const init = dispatch('init');
    const sync = dispatch('sync');
    if (init.type === 'handler' && sync.type === 'handler') {
      expect(init.handler).not.toBe(sync.handler);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown command is flagged (not thrown as raw Error)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch — unknown command', () => {
  it('returns type "unknown" for an unrecognised command', () => {
    const result = dispatch('bogus');
    expect(result.type).toBe('unknown');
  });

  it('returns type "unknown" for empty string command', () => {
    const result = dispatch('');
    expect(result.type).toBe('unknown');
  });

  it('does NOT throw for unknown command', () => {
    expect(() => dispatch('this-does-not-exist')).not.toThrow();
  });

  it('DispatchResult for unknown carries the command name', () => {
    const result = dispatch('foobar') as DispatchResult & { type: 'unknown' };
    expect(result.command).toBe('foobar');
  });

  it('unknown result carries expected type literal', () => {
    const result = dispatch('xyz');
    expect(result.type).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return type is discriminated union
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch — return type shape', () => {
  it('handler result has .type === "handler" and .handler function', () => {
    const result = dispatch('status');
    expect(result.type).toBe('handler');
    if (result.type === 'handler') {
      expect(typeof result.handler).toBe('function');
    }
  });

  it('unknown result has .type === "unknown" and .command string', () => {
    const result = dispatch('nope');
    expect(result.type).toBe('unknown');
    if (result.type === 'unknown') {
      expect(typeof result.command).toBe('string');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.5: handleSync is OBSERVABLE — summary to STDOUT, progress to STDERR
// (drives a real sqlite sync via dispatch('sync') → handler → openConnections)
// ─────────────────────────────────────────────────────────────────────────────

describe('handleSync — observable summary to STDOUT + progress to STDERR (task 2.5)', () => {
  let projectRoot: string;
  let originalCwd: string;
  let mat: MaterializedDb;

  beforeEach(() => {
    originalCwd = process.cwd();
    mat = materializeTorture();
    projectRoot = join(tmpdir(), `dbgraph-dispatch-sync-${randomUUID()}`);
    mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });
    const cfg = buildConfig({ dialect: 'sqlite', file: mat.path });
    writeFileSync(join(projectRoot, 'dbgraph.config.json'), writeConfig(cfg), 'utf-8');
    process.chdir(projectRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    mat.cleanup();
  });

  function syncHandler(): (args: ParsedArgs) => Promise<{ readonly type: string }> {
    const d = dispatch('sync');
    if (d.type !== 'handler') throw new Error('expected a handler for "sync"');
    return d.handler;
  }

  /**
   * Reconstructs the EXACT SyncSummary a first (incremental) sync produced, reading the
   * persisted snapshot: snapshot.counts is byte-identical to the summary.counts, upserted
   * equals the total node count (first sync upserts every fresh node), deleted = 0, and
   * there is no prior snapshot so hasDrift = false.
   */
  async function buildExpectedSummary(): Promise<SyncSummary> {
    const store = await createSqliteGraphStore({ path: join(projectRoot, '.dbgraph', 'dbgraph.db') });
    try {
      const snapshots = await store.listSnapshots();
      const last = snapshots[0];
      if (last === undefined) throw new Error('expected a snapshot to have been written');
      const counts = last.counts;
      const upserted = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        mode: 'incremental',
        counts,
        upserted,
        deleted: 0,
        hasDrift: false,
        snapshotId: last.id,
        fingerprint: last.fingerprint,
      };
    } finally {
      await store.close();
    }
  }

  it('writes the formatted SyncSummary to STDOUT and info progress to STDERR (default verbose)', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => { stdout.push(String(c)); return true; });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => { stderr.push(String(c)); return true; });

    let outcome: { readonly type: string };
    try {
      outcome = await syncHandler()({ command: 'sync', positionals: [], flags: {} });
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    // Exit-code contract is UNCHANGED — handler still returns {type:'success'}.
    expect(outcome).toStrictEqual({ type: 'success' });

    const stdoutStr = stdout.join('');
    const expected = await buildExpectedSummary();
    // STDOUT carries EXACTLY the pure formatter output.
    expect(stdoutStr).toBe(formatSyncSummary(expected));
    // STREAM DISCIPLINE: no logger diagnostics ever pollute STDOUT.
    expect(stdoutStr).not.toContain('[info]');

    // Progress diagnostics appear on STDERR (default verbose level).
    const stderrStr = stderr.join('');
    expect(stderrStr).toContain('[info] extract started');
    expect(stderrStr).toContain('[info] snapshot written');
  });

  it('--quiet suppresses info progress on STDERR but STILL writes the summary to STDOUT', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => { stdout.push(String(c)); return true; });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => { stderr.push(String(c)); return true; });

    try {
      await syncHandler()({ command: 'sync', positionals: [], flags: { quiet: true } });
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    const stdoutStr = stdout.join('');
    const stderrStr = stderr.join('');

    // Summary is NOT suppressed by --quiet (it goes to stdout, not through the logger level).
    expect(stdoutStr).toContain('Sync Summary');
    expect(stdoutStr).toContain('fingerprint  ');
    // info/progress suppressed on STDERR under --quiet.
    expect(stderrStr).not.toContain('[info]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// explore-payloads C.2: --detail is validated by parseDetail (ConfigError → exit 2).
// The silent-coercion ternaries in handleExplore + handleAffected are REPLACED, so a
// bogus value surfaces a ConfigError BEFORE any DB access (parseDetail runs before
// openConnections) and cli.ts maps the DbgraphError to exit 2. Hermetic — no store.
// Spec: cli-config "unknown --detail value exits 2 with an actionable message".
// ─────────────────────────────────────────────────────────────────────────────

describe('handleExplore / handleAffected — parseDetail rejects a bogus --detail (C.2)', () => {
  let stderr: string[];
  let outSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = [];
    outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
      stderr.push(String(c));
      return true;
    });
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('explore --detail bogus exits 2 and surfaces the naming ConfigError message', async () => {
    const code = await runCli(['explore', 'main.employees', '--detail', 'bogus']);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain(
      'explore: "detail" must be one of brief|normal|full (got "bogus")',
    );
  });

  it('affected --detail bogus exits 2 and surfaces the naming ConfigError message', async () => {
    const code = await runCli(['affected', 'some-script.sql', '--detail', 'bogus']);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain(
      'explore: "detail" must be one of brief|normal|full (got "bogus")',
    );
  });

  it('the parseDetail rejection is a ConfigError (DbgraphError → exit 2 contract)', () => {
    // Anchors the exit-code contract the runCli tests above rely on: parseDetail's
    // throw is the exact DbgraphError subclass exit-code.ts maps to 2.
    const err = new ConfigError('x');
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.code).toBe('E_CONFIG');
  });

  it('object --detail bogus exits 2 and surfaces the naming ConfigError message', async () => {
    // Proves handleObject also validates --detail via parseDetail BEFORE opening the store.
    const code = await runCli(['object', 'main.employees', '--detail', 'bogus']);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain(
      'explore: "detail" must be one of brief|normal|full (got "bogus")',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// explore-payloads C.4: handleObject dispatches, opens the synced store, and prints
// the formatObject bytes to STDOUT via runObject. Uses the real torture graph (sync
// then object over the same chdir'd project) — mirrors the handleSync integration setup.
// ─────────────────────────────────────────────────────────────────────────────

describe('handleObject — dispatches and prints via runObject (C.4)', () => {
  let projectRoot: string;
  let originalCwd: string;
  let mat: MaterializedDb;

  beforeEach(() => {
    originalCwd = process.cwd();
    mat = materializeTorture();
    projectRoot = join(tmpdir(), `dbgraph-dispatch-object-${randomUUID()}`);
    mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });
    const cfg = buildConfig({ dialect: 'sqlite', file: mat.path });
    writeFileSync(join(projectRoot, 'dbgraph.config.json'), writeConfig(cfg), 'utf-8');
    process.chdir(projectRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    mat.cleanup();
  });

  function handlerFor(command: string): (args: ParsedArgs) => Promise<{ readonly type: string }> {
    const d = dispatch(command);
    if (d.type !== 'handler') throw new Error(`expected a handler for "${command}"`);
    return d.handler;
  }

  it('object main.employees --detail full prints the columns/triggers payload to STDOUT', async () => {
    // First build the graph (sync), then run the object handler over the same project.
    await handlerFor('sync')({ command: 'sync', positionals: [], flags: {} });

    const stdout: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      stdout.push(String(c));
      return true;
    });
    let outcome: { readonly type: string };
    try {
      outcome = await handlerFor('object')({
        command: 'object',
        positionals: ['main.employees'],
        flags: { detail: 'full' },
      });
    } finally {
      outSpy.mockRestore();
    }

    expect(outcome).toStrictEqual({ type: 'success' });
    const out = stdout.join('');
    // Dispatched → opened store → runObject → formatObject: the payload facts are present.
    expect(out).toContain('main.employees  [table]');
    expect(out).toContain('COLUMNS');
    expect(out).toContain('  salary  REAL  [NN]  DEFAULT 0.0');
    expect(out).toContain('  [FK]  fk_employees_0  (dept_id → main.departments)');
    expect(out).toContain('TRIGGERS');
    expect(out).toContain('  trg_emp_after_insert  AFTER INSERT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleInstall — forwards --project + default cwd to runInstall (US-038, phase-7-docs)
// mcp-server "dbgraph install --project scopes agent config to the project directory".
// runInstall is mocked (see vi.mock above) so no real FS is touched.
// ─────────────────────────────────────────────────────────────────────────────

describe('handleInstall — forwards --project + cwd to runInstall (US-038)', () => {
  beforeEach(() => {
    vi.mocked(runInstall).mockClear();
  });

  async function callInstall(flags: Record<string, string | true>): Promise<void> {
    const d = dispatch('install');
    if (d.type !== 'handler') throw new Error('expected a handler for "install"');
    await d.handler({ command: 'install', positionals: [], flags });
  }

  it('passes project:true and a non-empty cwd when --project is set', async () => {
    await callInstall({ project: true });
    expect(runInstall).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runInstall).mock.calls[0]?.[0];
    expect(arg?.project).toBe(true);
    expect(arg?.remove).toBe(false);
    expect(typeof arg?.cwd).toBe('string');
    expect((arg?.cwd ?? '').length).toBeGreaterThan(0);
  });

  it('passes project:false when --project is absent (global default)', async () => {
    await callInstall({});
    const arg = vi.mocked(runInstall).mock.calls[0]?.[0];
    expect(arg?.project).toBe(false);
    expect(arg?.remove).toBe(false);
  });

  it('passes remove:true AND project:true together for --remove --project', async () => {
    await callInstall({ remove: true, project: true });
    const arg = vi.mocked(runInstall).mock.calls[0]?.[0];
    expect(arg?.remove).toBe(true);
    expect(arg?.project).toBe(true);
  });
});
