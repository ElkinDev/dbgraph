/**
 * installer fail-closed smoke — install.ps1 / install.sh checksum gate (spec R5, design D11).
 *
 * ARTIFACT-level (D12): spawns the REAL installer shell scripts and is EXCLUDED from `npm test`
 * (run via `npm run smoke:binary`). Unlike the binary smokes it needs NO built binary and NO
 * DBGRAPH_BINARY_PATH — it stubs the "release" with LOCAL fixtures (a fake asset + a SHA256SUMS
 * it controls). Each installer suite SKIPS cleanly when its interpreter (bash / powershell) is
 * absent, so this never fails on a host missing one shell.
 *
 * Proves the D11 fail-closed contract for BOTH installers:
 *   (a) matching checksum → the binary is placed on the install dir, exit 0.
 *   (b) tampered checksum → NOTHING is placed (partial deleted), non-zero exit — fail closed.
 *   (c) the asset URL + checksum are selected by the version+platform pair (print-plan), not
 *       hard-coded to a single artifact.
 *
 * The download is redirected to a local fixture dir via DBGRAPH_DOWNLOAD_BASE; the platform is
 * pinned via DBGRAPH_OS/DBGRAPH_ARCH so install.sh exercises the linux target on any host.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const installSh = join(repoRoot, 'install.sh');
const installPs1 = join(repoRoot, 'install.ps1');

/** bash consumes Windows drive paths only with forward slashes (C:\x → C:/x). */
function toBashPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Writes a fake "release" dir: the asset file + a SHA256SUMS listing `<checksum>  <asset>`. */
function writeRelease(dir: string, asset: string, content: Buffer, publishedChecksum: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, asset), content);
  writeFileSync(join(dir, 'SHA256SUMS'), `${publishedChecksum}  ${asset}\n`, 'utf-8');
}

const hasBash = spawnSync('bash', ['-c', 'exit 0']).error === undefined;
const hasPwsh = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']).error === undefined;

// ── install.sh (linux target, forced via DBGRAPH_OS/ARCH) ─────────────────────────────────────

describe.skipIf(!hasBash)('install.sh — checksum fail-closed (spec R5, design D11)', () => {
  const asset = 'dbgraph-linux-x64';
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'dbgraph-install-sh-'));
  });
  afterAll(() => {
    if (root !== undefined && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  function runSh(
    env: Record<string, string>,
    args: readonly string[] = [],
  ): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('bash', [toBashPath(installSh), ...args], {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('(a) matching checksum installs the binary on the install dir and exits 0', () => {
    const caseDir = mkdtempSync(join(root, 'ok-'));
    const releaseDir = join(caseDir, 'release');
    const installDir = join(caseDir, 'bin');
    const content = Buffer.from('fake-sea-binary-ok\n');
    writeRelease(releaseDir, asset, content, sha256(content));

    const r = runSh({
      DBGRAPH_OS: 'linux',
      DBGRAPH_ARCH: 'x64',
      DBGRAPH_DOWNLOAD_BASE: toBashPath(releaseDir),
      DBGRAPH_INSTALL_DIR: toBashPath(installDir),
    });

    expect(r.status, `install.sh should succeed on a match: ${r.stderr}`).toBe(0);
    expect(existsSync(join(installDir, 'dbgraph'))).toBe(true);
  });

  it('(b) tampered checksum fails closed — nothing on PATH, non-zero exit', () => {
    const caseDir = mkdtempSync(join(root, 'bad-'));
    const releaseDir = join(caseDir, 'release');
    const installDir = join(caseDir, 'bin');
    const content = Buffer.from('fake-sea-binary-tampered\n');
    // Published checksum belongs to DIFFERENT bytes → the download will not verify.
    const wrongChecksum = sha256(Buffer.from('some-other-bytes\n'));
    writeRelease(releaseDir, asset, content, wrongChecksum);

    const r = runSh({
      DBGRAPH_OS: 'linux',
      DBGRAPH_ARCH: 'x64',
      DBGRAPH_DOWNLOAD_BASE: toBashPath(releaseDir),
      DBGRAPH_INSTALL_DIR: toBashPath(installDir),
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('mismatch');
    // Fail closed: nothing placed — the install dir was never even created.
    expect(existsSync(join(installDir, 'dbgraph'))).toBe(false);
  });

  it('(c) asset URL + checksum are selected by version+platform (print-plan)', () => {
    const planA = runSh(
      { DBGRAPH_OS: 'linux', DBGRAPH_ARCH: 'x64', DBGRAPH_INSTALL_PRINT_PLAN: '1' },
      ['--version', '1.2.3'],
    );
    const planB = runSh(
      { DBGRAPH_OS: 'linux', DBGRAPH_ARCH: 'x64', DBGRAPH_INSTALL_PRINT_PLAN: '1' },
      ['--version', '9.9.9'],
    );

    expect(planA.status).toBe(0);
    expect(planA.stdout).toContain('dbgraph-linux-x64'); // asset is platform-derived
    expect(planA.stdout).toContain('/v1.2.3/'); // version is in the URL
    expect(planB.stdout).toContain('/v9.9.9/');
    expect(planA.stdout).not.toBe(planB.stdout); // not hard-coded to one artifact
  });
});

// ── install.ps1 (win32 target) ────────────────────────────────────────────────────────────────

describe.skipIf(!hasPwsh)('install.ps1 — checksum fail-closed (spec R5, design D11)', () => {
  const asset = 'dbgraph-win-x64.exe';
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'dbgraph-install-ps1-'));
  });
  afterAll(() => {
    if (root !== undefined && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  function runPs1(
    env: Record<string, string>,
    args: readonly string[] = [],
  ): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installPs1, ...args],
      { encoding: 'utf-8', env: { ...process.env, ...env } },
    );
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('(a) matching checksum installs the binary on the install dir and exits 0', () => {
    const caseDir = mkdtempSync(join(root, 'ok-'));
    const releaseDir = join(caseDir, 'release');
    const installDir = join(caseDir, 'bin');
    const content = Buffer.from('fake-sea-exe-ok\n');
    writeRelease(releaseDir, asset, content, sha256(content));

    const r = runPs1({
      DBGRAPH_OS: 'win32',
      DBGRAPH_ARCH: 'x64',
      DBGRAPH_DOWNLOAD_BASE: releaseDir,
      DBGRAPH_INSTALL_DIR: installDir,
    });

    expect(r.status, `install.ps1 should succeed on a match: ${r.stderr}`).toBe(0);
    expect(existsSync(join(installDir, 'dbgraph.exe'))).toBe(true);
  });

  it('(b) tampered checksum fails closed — nothing on PATH, non-zero exit', () => {
    const caseDir = mkdtempSync(join(root, 'bad-'));
    const releaseDir = join(caseDir, 'release');
    const installDir = join(caseDir, 'bin');
    const content = Buffer.from('fake-sea-exe-tampered\n');
    const wrongChecksum = sha256(Buffer.from('some-other-exe-bytes\n'));
    writeRelease(releaseDir, asset, content, wrongChecksum);

    const r = runPs1({
      DBGRAPH_OS: 'win32',
      DBGRAPH_ARCH: 'x64',
      DBGRAPH_DOWNLOAD_BASE: releaseDir,
      DBGRAPH_INSTALL_DIR: installDir,
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('mismatch');
    expect(existsSync(join(installDir, 'dbgraph.exe'))).toBe(false);
  });

  it('(c) asset URL + checksum are selected by version+platform (print-plan)', () => {
    const planA = runPs1(
      { DBGRAPH_OS: 'win32', DBGRAPH_ARCH: 'x64', DBGRAPH_INSTALL_PRINT_PLAN: '1' },
      ['-Version', '1.2.3'],
    );
    const planB = runPs1(
      { DBGRAPH_OS: 'win32', DBGRAPH_ARCH: 'x64', DBGRAPH_INSTALL_PRINT_PLAN: '1' },
      ['-Version', '9.9.9'],
    );

    expect(planA.status).toBe(0);
    expect(planA.stdout).toContain('dbgraph-win-x64.exe');
    expect(planA.stdout).toContain('/v1.2.3/');
    expect(planB.stdout).toContain('/v9.9.9/');
    expect(planA.stdout).not.toBe(planB.stdout);
  });
});
