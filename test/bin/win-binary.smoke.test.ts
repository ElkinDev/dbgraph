/**
 * win-binary smoke — the no-node_modules SEA binary gate (spec R1/R2/R3, design D8/D9).
 *
 * ARTIFACT-level: requires a BUILT SEA binary at DBGRAPH_BINARY_PATH and is EXCLUDED
 * from `npm test` (D12) — run via `npm run smoke:binary`. SKIPS cleanly when the env
 * var is absent or the binary does not exist (never fails).
 *
 * The binary is COPIED OUTSIDE the repo tree before running, and every command runs in
 * a temp cwd OUTSIDE the repo with NO node_modules — otherwise loadOptionalDriver's
 * `process.execPath` fallback (or a cwd walk) would resolve the repo's node_modules and
 * the "no driver resolvable" precondition would be violated (observed: pg reaching the
 * connect step instead of the driver-miss error). NODE_PATH is cleared for the same
 * reason. The source graph is built on the in-binary `node:sqlite` (driver: node:sqlite
 * in the config + the isSea store flip) with ZERO native modules.
 *
 * Covers:
 *   R2 — `--version` == package.json version; `--help` prints the usage banner.
 *   R1/R2 — init→sync→query <term> exits 0 with output BYTE-IDENTICAL to the golden.
 *   R3 — a live-DB command with no resolvable driver fails with the EXACT
 *        `Required driver '<name>' is not installed. Run: npm i <name>` (exit 2, no stack).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const pkgVersion = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as { version: string })
  .version;
const goldenQueryOrders = join(here, 'golden', 'query-orders.txt');

const binaryPath = process.env['DBGRAPH_BINARY_PATH'];
const hasBinary = binaryPath !== undefined && binaryPath.length > 0 && existsSync(binaryPath);

/** The controlled source schema — `query orders` yields the committed golden. */
const SOURCE_SCHEMA = `
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL);
  CREATE INDEX idx_orders_customer ON orders(customer_id);
`;

/** Normalizes CRLF→LF so the golden comparison is stable across platforms/checkouts. */
function lf(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

describe.skipIf(!hasBinary)('win-x64 SEA binary — no-node_modules smoke (spec R1/R2/R3)', () => {
  let exeOutsideRepo: string;
  let projectDir: string;
  let tmpRoot: string;

  /** Runs the copied binary from OUTSIDE the repo with a clean (NODE_PATH-free) env. */
  function runExe(
    args: readonly string[],
    opts: { cwd: string; env?: Record<string, string> } = { cwd: projectDir },
  ): { status: number | null; stdout: string; stderr: string } {
    const env = { ...process.env, ...(opts.env ?? {}) };
    delete env['NODE_PATH']; // never let the exe resolve drivers via NODE_PATH
    const r = spawnSync(exeOutsideRepo, [...args], {
      cwd: opts.cwd,
      env,
      encoding: 'utf-8',
      windowsHide: true,
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  beforeAll(() => {
    // 1. Copy the binary OUTSIDE the repo tree (tmpdir has no node_modules up-chain).
    tmpRoot = mkdtempSync(join(tmpdir(), 'dbgraph-smoke-'));
    const exeName = process.platform === 'win32' ? 'dbgraph.exe' : 'dbgraph';
    exeOutsideRepo = join(tmpRoot, 'bin', exeName);
    mkdirSync(dirname(exeOutsideRepo), { recursive: true });
    copyFileSync(binaryPath as string, exeOutsideRepo);

    // 2. Fresh project dir (no node_modules) + a node:sqlite-readable source db.
    projectDir = join(tmpRoot, 'project');
    mkdirSync(projectDir, { recursive: true });
    const sourceDb = join(projectDir, 'source.db');
    const db = new Database(sourceDb);
    db.exec(SOURCE_SCHEMA);
    db.close();

    // 3. init → writes config (driver: node:sqlite) AND runs the first sync on the
    //    in-binary node:sqlite (store flips via isSea). No native module, no node_modules.
    const init = runExe(['init', '--dialect', 'sqlite', '--file', sourceDb, '--driver', 'node:sqlite']);
    expect(init.status, `init failed: ${init.stderr}`).toBe(0);
  });

  afterAll(() => {
    if (tmpRoot !== undefined && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('--version prints EXACTLY the package.json version and exits 0 (R2)', () => {
    const r = runExe(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkgVersion);
    expect(r.stderr).toBe('');
  });

  it('--help prints the usage banner and exits 0 (R2)', () => {
    const r = runExe(['--help']);
    expect(r.status).toBe(0);
    expect(lf(r.stdout).startsWith('dbgraph — database schema graph indexer')).toBe(true);
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('query');
  });

  it('query <term> reads the graph on node:sqlite and matches the golden BYTE-for-BYTE (R1/R2, ADR-008)', () => {
    const r = runExe(['query', 'orders']);
    expect(r.status).toBe(0);
    const golden = lf(readFileSync(goldenQueryOrders, 'utf-8'));
    expect(lf(r.stdout)).toBe(golden);
  });

  it('a second query is byte-identical to the first (deterministic, R6)', () => {
    const a = runExe(['query', 'orders']);
    const b = runExe(['query', 'orders']);
    expect(lf(a.stdout)).toBe(lf(b.stdout));
  });

  // R3 — driver-degradation preserved in the binary (task 2.7).
  it('a live-DB command with no resolvable driver fails with the EXACT install error (exit 2, no stack)', () => {
    const degDir = join(tmpRoot, 'degrade');
    mkdirSync(degDir, { recursive: true });
    writeFileSync(
      join(degDir, 'dbgraph.config.json'),
      JSON.stringify(
        { dialect: 'pg', source: { host: 'localhost', database: 'nodb', user: 'nouser', password: '${env:PGPASS}' } },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    const r = runExe(['sync'], { cwd: degDir, env: { PGPASS: 'irrelevant' } });

    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Required driver 'pg' is not installed. Run: npm i pg");
    // No raw stack trace leaked (content-free connectivity contract).
    expect(/^\s+at\s+/m.test(r.stderr)).toBe(false);
  });
});
