/**
 * build-bundle — produces the single self-contained SEA bundle (design D8, phase-9.5c).
 *
 * Reads package.json.version, hands buildOptions(version) to esbuild, and emits
 * build/sea/dbgraph.cjs — ONE CJS file with the 5 DB drivers + better-sqlite3 kept
 * external (their lazy import() survives; NONE inlined). This is the shared bundle
 * both the Windows (build-sea.ps1) and Linux (build-sea.sh) SEA assemblies consume;
 * only the postject host Node differs per platform.
 *
 * Determinism (ADR-008): buildOptions disables minify/sourcemap/legal-comment scan,
 * so the same source on the pinned Node yields a byte-identical bundle across rebuilds.
 *
 * Not part of `npm test` (D12) — invoked via `npm run bundle:sea`.
 */

import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildOptions } from './esbuild-config.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
const version = pkg.version;

// esbuild resolves entryPoints/outfile relative to cwd — run from the repo root.
process.chdir(repoRoot);
mkdirSync(join(repoRoot, 'build', 'sea'), { recursive: true });

const options = buildOptions(version);
await build(options);

console.log(`bundled ${options.entryPoints[0]} → ${options.outfile} (version ${version})`);
