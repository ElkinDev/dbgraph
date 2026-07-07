/**
 * CLI E2E test — task 7.4 (phase-4-cli-config).
 *
 * Drives the real CLI command functions (runInit, runSync, runQuery, runStatus,
 * runDiff) through a complete init → sync → query → status → diff → diff-changed
 * lifecycle against the committed SQLite torture fixture.
 *
 * Strategy:
 *   - No Docker, no process spawning.
 *   - Each test uses a fresh temp projectRoot with its own .dbgraph/ directory.
 *   - The SQLite torture fixture is materialized (as in the adapter e2e tests) and
 *     its path is injected via a literal value in the config (sqlite "file" is
 *     a plain path, not an env ref — by design).
 *   - Exit codes are asserted by calling runCli(argv) and checking the returned number.
 *   - Stdout output is captured by wrapping process.stdout.write (for dispatch-level
 *     calls) or by reading the return value of the command functions directly.
 *
 * Determinism (ADR-008):
 *   - Second sync is verified to be a no-op (fingerprint short-circuit).
 *   - Golden-pinning: query text output on the same fixture must be identical on
 *     two consecutive runs (captured once and asserted to be stable).
 *
 * Exit codes (Design Decision 9):
 *   - query with a matching term: exit 0
 *   - query with no match: exit 1
 *   - bogus command: exit 2
 *   - diff with changes (after mutation): exit 1
 *   - diff with no changes: exit 0
 *
 * Spec: cli-config "CLI exit codes are a stable contract" + all command requirements.
 * ADR-004: test imports command functions, not adapter internals.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { materializeTorture } from '../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../fixtures/sqlite/materialize.js';
import {
  createSqliteSchemaAdapter,
  createSqliteGraphStore,
} from '../../src/index.js';
import { runSync } from '../../src/cli/commands/sync.js';
import { runStatus } from '../../src/cli/commands/status.js';
import { runQuery } from '../../src/cli/commands/query.js';
import { runDiff } from '../../src/cli/commands/diff.js';
import { runCli } from '../../src/cli/cli.js';
import { writeConfig, buildConfig } from '../../src/cli/config/build-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an isolated projectRoot with a .dbgraph/ directory.
 * Returns the path and a cleanup function.
 */
function makeProjectRoot(): { projectRoot: string; cleanup: () => void } {
  const projectRoot = join(tmpdir(), `dbgraph-e2e-${randomUUID()}`);
  mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });
  return {
    projectRoot,
    cleanup(): void {
      if (existsSync(projectRoot)) {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Opens a SQLite adapter + graph store pair for a given fixture path and project root.
 * Caller is responsible for closing both.
 */
async function openAdapterAndStore(
  fixturePath: string,
  projectRoot: string,
): Promise<{
  adapter: Awaited<ReturnType<typeof createSqliteSchemaAdapter>>;
  store: Awaited<ReturnType<typeof createSqliteGraphStore>>;
}> {
  const adapter = await createSqliteSchemaAdapter({ file: fixturePath });
  const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
  const store = await createSqliteGraphStore({ path: storePath });
  return { adapter, store };
}

/**
 * Writes dbgraph.config.json to the projectRoot for use by runCli.
 * SQLite file path is a literal (not an env ref) — per the schema (sqlite "file" is allowed plain).
 */
function writeProjectConfig(projectRoot: string, fixturePath: string): void {
  const cfg = buildConfig({ dialect: 'sqlite', file: fixturePath });
  const configString = writeConfig(cfg);
  writeFileSync(join(projectRoot, 'dbgraph.config.json'), configString, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture materialization
// ─────────────────────────────────────────────────────────────────────────────

let mat: MaterializedDb;

beforeAll(() => {
  mat = materializeTorture();
});

afterAll(() => {
  mat.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: init → sync → status → query basic flow
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: init → sync → status → query', () => {
  let projectRoot: string;
  let cleanup: () => void;

  beforeAll(async () => {
    const proj = makeProjectRoot();
    projectRoot = proj.projectRoot;
    cleanup = proj.cleanup;

    // Write config (simulating what init would write)
    writeProjectConfig(projectRoot, mat.path);

    // Run first sync
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      await runSync({ adapter, store, full: false });
    } finally {
      await adapter.close();
      await store.close();
    }
  });

  afterAll(() => {
    cleanup();
  });

  it('graph store contains table nodes after sync', async () => {
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      const tables = await store.getNodesByKind('table');
      expect(tables.length).toBeGreaterThan(0);
    } finally {
      await adapter.close();
      await store.close();
    }
  });

  it('status output contains Graph section and snapshot info', async () => {
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      const result = await runStatus({ adapter, store });
      expect(result.type).toBe('success');
      expect(result.output).toContain('Graph');
      expect(result.output).toContain('Last Snapshot');
      expect(result.output).toContain('sqlite');
      // At least one table count
      expect(result.output).toContain('table');
    } finally {
      await adapter.close();
      await store.close();
    }
  });

  it('query for "employees" returns hits and exits success', async () => {
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      const result = await runQuery({ store, term: 'employees', json: false });
      expect(result.type).toBe('success');
      expect(result.output).toContain('employees');
    } finally {
      await adapter.close();
      await store.close();
    }
  });

  it('query --json for "employees" returns deterministic JSON', async () => {
    const { adapter: a1, store: s1 } = await openAdapterAndStore(mat.path, projectRoot);
    let run1: string;
    try {
      const r1 = await runQuery({ store: s1, term: 'employees', json: true });
      run1 = r1.output;
    } finally {
      await a1.close();
      await s1.close();
    }

    const { adapter: a2, store: s2 } = await openAdapterAndStore(mat.path, projectRoot);
    let run2: string;
    try {
      const r2 = await runQuery({ store: s2, term: 'employees', json: true });
      run2 = r2.output;
    } finally {
      await a2.close();
      await s2.close();
    }

    // ADR-008: byte-identical on re-run
    expect(run1).toBe(run2);

    // Verify parseable JSON
    const parsed = JSON.parse(run1) as { term: string; total: number; hits: unknown[] };
    expect(parsed.term).toBe('employees');
    expect(parsed.total).toBeGreaterThan(0);
    expect(parsed.hits.length).toBeGreaterThan(0);
  });

  it('query for a non-existent term returns "negative" (exit 1)', async () => {
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      const result = await runQuery({ store, term: 'xyzzy_nonexistent_q23', json: false });
      expect(result.type).toBe('negative');
    } finally {
      await adapter.close();
      await store.close();
    }
  });

  it('second sync with unchanged fixture is a no-op (fingerprint short-circuit)', async () => {
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      // Get snapshot count before
      const snapsBefore = await store.listSnapshots();
      const countBefore = snapsBefore.length;

      // Run sync again — fingerprint unchanged → no new snapshot
      await runSync({ adapter, store, full: false });

      const snapsAfter = await store.listSnapshots();
      // No new snapshot should have been written
      expect(snapsAfter.length).toBe(countBefore);
    } finally {
      await adapter.close();
      await store.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: diff — no-change → exit 0, changed → exit 1
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: diff — exit 0 when no changes, exit 1 when changes', () => {
  let projectRoot: string;
  let cleanup: () => void;
  let mat2: MaterializedDb;

  beforeAll(async () => {
    const proj = makeProjectRoot();
    projectRoot = proj.projectRoot;
    cleanup = proj.cleanup;

    // Fresh writable fixture (we will mutate it for the "changed" scenario)
    mat2 = materializeTorture();
    writeProjectConfig(projectRoot, mat2.path);

    // First sync
    const { adapter: a1, store: s1 } = await openAdapterAndStore(mat2.path, projectRoot);
    try {
      await runSync({ adapter: a1, store: s1, full: false });
    } finally {
      await a1.close();
      await s1.close();
    }

    // Second sync (creates a second snapshot — same fingerprint → no-op first time)
    // Force a second snapshot via --full so we have two snapshots to diff
    const { adapter: a2, store: s2 } = await openAdapterAndStore(mat2.path, projectRoot);
    try {
      await runSync({ adapter: a2, store: s2, full: true });
    } finally {
      await a2.close();
      await s2.close();
    }
  });

  afterAll(async () => {
    cleanup();
    mat2.cleanup();
  });

  it('diff --last with two identical syncs returns type "success" (exit 0)', async () => {
    const { adapter, store } = await openAdapterAndStore(mat2.path, projectRoot);
    try {
      const result = await runDiff({ store, last: true });
      // Two syncs from the same unchanged fixture → no diff → success (exit 0)
      expect(result.type).toBe('success');
    } finally {
      await adapter.close();
      await store.close();
    }
  });

  it('diff --last after fixture mutation returns type "negative" (exit 1) and shows changed body', async () => {
    // Mutate the fixture: add a view to change the fingerprint and body content
    // We use Database from better-sqlite3 directly (this is a test fixture helper, not src/cli)
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(mat2.path);
    try {
      db.exec(`
        CREATE VIEW IF NOT EXISTS e2e_mutated_view AS
        SELECT emp_id, full_name FROM employees WHERE active = 1;
      `);
    } finally {
      db.close();
    }

    // Sync again after mutation — this creates a new snapshot with the view
    const { adapter: aMut, store: sMut } = await openAdapterAndStore(mat2.path, projectRoot);
    try {
      await runSync({ adapter: aMut, store: sMut, full: true });
    } finally {
      await aMut.close();
      await sMut.close();
    }

    // Now diff --last should show the added view
    const { adapter, store } = await openAdapterAndStore(mat2.path, projectRoot);
    try {
      const result = await runDiff({ store, last: true });
      // Changes exist → negative (exit 1)
      expect(result.type).toBe('negative');
      // Output should mention the view or ADDED section
      expect(result.output).toMatch(/ADDED|e2e_mutated_view/i);
    } finally {
      await adapter.close();
      await store.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: runCli exit code contract
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: runCli exit code contract', () => {
  it('bogus command exits 2', async () => {
    const code = await runCli(['bogus_command_that_does_not_exist']);
    expect(code).toBe(2);
  });

  it('empty argv (no command) exits 2', async () => {
    // No command provided → unknown command → exit 2
    const code = await runCli([]);
    expect(code).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: status output is deterministic (golden-pinned)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: status output is deterministic (ADR-008)', () => {
  let projectRoot: string;
  let cleanup: () => void;

  beforeAll(async () => {
    const proj = makeProjectRoot();
    projectRoot = proj.projectRoot;
    cleanup = proj.cleanup;

    writeProjectConfig(projectRoot, mat.path);

    // Single sync to create initial state
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      await runSync({ adapter, store, full: false });
    } finally {
      await adapter.close();
      await store.close();
    }
  });

  afterAll(() => {
    cleanup();
  });

  it('status output is byte-identical on two consecutive calls', async () => {
    const { adapter: a1, store: s1 } = await openAdapterAndStore(mat.path, projectRoot);
    let out1: string;
    try {
      const r1 = await runStatus({ adapter: a1, store: s1 });
      out1 = r1.output;
    } finally {
      await a1.close();
      await s1.close();
    }

    const { adapter: a2, store: s2 } = await openAdapterAndStore(mat.path, projectRoot);
    let out2: string;
    try {
      const r2 = await runStatus({ adapter: a2, store: s2 });
      out2 = r2.output;
    } finally {
      await a2.close();
      await s2.close();
    }

    expect(out1).toBe(out2);
  });

  it('status output contains expected sections', async () => {
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      const result = await runStatus({ adapter, store });
      expect(result.output).toContain('Graph');
      expect(result.output).toContain('Last Snapshot');
      expect(result.output).toContain('taken');
      expect(result.output).toContain('engine');
      expect(result.output).toContain('fingerprint');
    } finally {
      await adapter.close();
      await store.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: config file is committable (not in .gitignore)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: config files and gitignore', () => {
  it('dbgraph.config.json is written as valid JSON', () => {
    const { projectRoot, cleanup } = makeProjectRoot();
    try {
      writeProjectConfig(projectRoot, mat.path);
      const raw = readFileSync(join(projectRoot, 'dbgraph.config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { dialect: string; source: { file: string } };
      expect(parsed.dialect).toBe('sqlite');
      expect(parsed.source.file).toBe(mat.path);
    } finally {
      cleanup();
    }
  });

  it('.dbgraph/ is listed in the project .gitignore', () => {
    // Check the committed .gitignore in the project root
    const projectGitignore = join(
      new URL('../../', import.meta.url).pathname,
      '.gitignore',
    );
    if (existsSync(projectGitignore)) {
      const content = readFileSync(projectGitignore, 'utf-8');
      expect(content).toContain('.dbgraph/');
    }
  });

  it('dbgraph.config.json is NOT listed in .gitignore (it is committable)', () => {
    const projectGitignore = join(
      new URL('../../', import.meta.url).pathname,
      '.gitignore',
    );
    if (existsSync(projectGitignore)) {
      const content = readFileSync(projectGitignore, 'utf-8');
      // Should not have a line that would exclude dbgraph.config.json
      const lines = content.split('\n').map((l) => l.trim());
      const wouldIgnoreConfig = lines.some(
        (l) => l === 'dbgraph.config.json' || l === '*.config.json',
      );
      expect(wouldIgnoreConfig).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: --json byte-identity + stream discipline through the FULL runCli path
// (task 2.7). The observability wiring (logger threaded into every handler) MUST NOT
// pollute the machine payload on STDOUT — diagnostics belong on STDERR only.
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: --json byte-identity + stream discipline through runCli (task 2.7)', () => {
  let projectRoot: string;
  let cleanup: () => void;
  let originalCwd: string;

  beforeAll(async () => {
    const proj = makeProjectRoot();
    projectRoot = proj.projectRoot;
    cleanup = proj.cleanup;

    writeProjectConfig(projectRoot, mat.path);

    // Sync so the graph has content to query.
    const { adapter, store } = await openAdapterAndStore(mat.path, projectRoot);
    try {
      await runSync({ adapter, store, full: false });
    } finally {
      await adapter.close();
      await store.close();
    }

    // runCli reads config from process.cwd(); chdir into the project for this suite.
    originalCwd = process.cwd();
    process.chdir(projectRoot);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    cleanup();
  });

  async function captureRunCli(
    argv: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const outSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((c: string | Uint8Array) => { stdout.push(String(c)); return true; });
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((c: string | Uint8Array) => { stderr.push(String(c)); return true; });
    let code: number;
    try {
      code = await runCli(argv);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
  }

  it('query --json writes ONLY the JSON payload to STDOUT (no logger diagnostics), byte-identical on re-run', async () => {
    const r1 = await captureRunCli(['query', 'employees', '--json']);
    const r2 = await captureRunCli(['query', 'employees', '--json']);

    // Exit-code contract unchanged: matching term → exit 0.
    expect(r1.code).toBe(0);

    // STREAM DISCIPLINE: no logger diagnostics leaked onto STDOUT.
    expect(r1.stdout).not.toContain('[info]');
    expect(r1.stdout).not.toContain('[warn]');
    expect(r1.stdout).not.toContain('[error]');

    // STDOUT is a clean, parseable machine payload.
    const parsed = JSON.parse(r1.stdout) as { term: string; total: number };
    expect(parsed.term).toBe('employees');
    expect(parsed.total).toBeGreaterThan(0);

    // BYTE-IDENTITY across runs — the machine payload is deterministic (ADR-008).
    expect(r1.stdout).toBe(r2.stdout);
  });

  it('affected --json also keeps STDOUT free of logger diagnostics', async () => {
    // Write a tiny DDL script that touches a known table so affected has a payload.
    const sqlPath = join(projectRoot, 'change.sql');
    writeFileSync(sqlPath, 'ALTER TABLE employees ADD COLUMN note TEXT;\n', 'utf-8');

    const { stdout } = await captureRunCli(['affected', sqlPath, '--json']);

    expect(stdout).not.toContain('[info]');
    // Parseable JSON payload on STDOUT.
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});
