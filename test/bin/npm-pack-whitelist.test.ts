/**
 * npm-pack tarball whitelist gate — what actually ships must be dist-only (phase-9.5d-release).
 *
 * Two layers of defense (design §"npm-pack gate"):
 *
 *   1. ALWAYS-ON `files` unit — reads `package.json` from disk and asserts `files === ['dist']`.
 *      This is the instant tripwire that stays green regardless of whether npm or a built
 *      `dist/` are present. If someone widens `files`, this fails immediately.
 *
 *   2. BEHAVIOURAL spawn gate — runs the REAL `npm pack --dry-run --json`, parses the packed
 *      file list, and asserts EVERY entry is in the whitelist (`dist/**` + `package.json` +
 *      `README.md` + `LICENSE`) with NO `benchmark/ openspec/ scripts/ test/ src/` leak. This
 *      validates npm's actual inclusion rules (the always-included set + `files`), not a proxy.
 *
 * BUILD PRECONDITION (spec R2 S7): a COMPLETE dist file list requires a prior `npm run build`.
 * The whitelist/leak assertions are meaningful whether or not `dist/` is built (an unbuilt dist
 * only yields FEWER files, never a forbidden one). The positive "dist payload is present" check
 * is gated on `dist/cli.js` existing, so `npm test` stays green on a clean checkout with no build.
 *
 * WINDOWS GOTCHA: `spawnSync('npm', …)` is ENOENT because npm is `npm.cmd`. We prefer the npm
 * CLI JS entrypoint (`process.env.npm_execpath`, set when run via `npm test`) invoked through the
 * current Node (`process.execPath`); otherwise we fall back to `spawnSync('npm', …, {shell:true})`.
 * We PROBE npm (`--version`, status 0) first and `skipIf(!hasNpm)` — mirroring the `hasBash`/
 * `hasPwsh` pattern in `install.smoke.test.ts` — so a host without npm skips cleanly, leaving the
 * `files` unit as the always-on backstop.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
  files: string[];
};

// ── npm invocation shim (cross-platform) ──────────────────────────────────────
const npmExecpath = process.env['npm_execpath'];
const viaNodeEntrypoint = npmExecpath !== undefined && npmExecpath.endsWith('.js');

function runNpm(args: readonly string[]): SpawnSyncReturns<string> {
  if (viaNodeEntrypoint && npmExecpath !== undefined) {
    // `node <path-to>/npm-cli.js …` — bypasses the `.cmd` shim entirely.
    return spawnSync(process.execPath, [npmExecpath, ...args], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  // Fallback: let the shell resolve `npm` → `npm.cmd` on Windows.
  return spawnSync('npm', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

const probe = runNpm(['--version']);
const hasNpm = probe.status === 0;

const distBuilt = existsSync(join(repoRoot, 'dist', 'cli.js'));

// The whitelist contract (design §"Interfaces / Contracts").
const isAllowed = (p: string): boolean =>
  p === 'package.json' || p === 'README.md' || p === 'LICENSE' || p.startsWith('dist/');
const isForbidden = (p: string): boolean => /^(benchmark|openspec|scripts|test|src)\//.test(p);

// ── Layer 1: always-on `files` unit (instant tripwire) ────────────────────────
describe('package.json files whitelist (always-on backstop)', () => {
  it('files is exactly ["dist"] — nothing else may be shipped by the whitelist', () => {
    expect(pkg.files).toStrictEqual(['dist']);
  });
});

// ── Layer 2: real `npm pack --dry-run --json` behavioural gate ─────────────────
describe.skipIf(!hasNpm)('npm pack --dry-run whitelist (real packer)', () => {
  const r = runNpm(['pack', '--dry-run', '--json']);
  // npm --json writes the JSON array to stdout; slice from the first '[' to tolerate
  // any leading notice noise, then parse the packed file list.
  const jsonStart = r.stdout.indexOf('[');
  const parsed = JSON.parse(r.stdout.slice(jsonStart)) as Array<{
    files: Array<{ path: string }>;
  }>;
  const first = parsed[0];
  if (first === undefined) {
    throw new Error(`npm pack --dry-run --json returned no pack entries; stdout: ${r.stdout}`);
  }
  const paths = first.files.map((f) => f.path.replace(/\\/g, '/'));

  it('npm pack exits 0 and yields a parseable file list', () => {
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(paths.length).toBeGreaterThan(0);
  });

  it('every packed path is in the whitelist — no unexpected file ships (R2 S5)', () => {
    const offenders = paths.filter((p) => !isAllowed(p));
    expect(offenders, `unexpected files in tarball: ${offenders.join(', ')}`).toStrictEqual([]);
  });

  it('NO source/test/tooling path leaks into the tarball (R2 S6)', () => {
    const leaks = paths.filter(isForbidden);
    expect(leaks, `benchmark/openspec/scripts/test/src leak: ${leaks.join(', ')}`).toStrictEqual(
      [],
    );
  });

  it.skipIf(!distBuilt)('the built dist/** payload is present (build precondition met, R2 S7)', () => {
    expect(paths.some((p) => p.startsWith('dist/'))).toBe(true);
  });
});
