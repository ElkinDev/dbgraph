#!/usr/bin/env node
/**
 * sea-entry — the DEDICATED, bundle-only SEA entry (design D5, phase-9.5c).
 *
 * The esbuild bundle's `main` is THIS module. Under a SEA, `cli.ts`'s
 * `import.meta.url === pathToFileURL(process.argv[1])` auto-run guard evaluates
 * FALSE (there is no script-path arg), so the CLI would never run on its own — this
 * dedicated entry does the running instead.
 *
 * Responsibilities:
 *   1. planEntry(argv, isSea) — PURE argv normalization + `mcp` vs `cli` routing.
 *   2. Install the Batch-0.4 defensive `process.on('warning')` filter (swallows ONLY
 *      the node:sqlite ExperimentalWarning; a no-op on the pinned Node 24.18.0 where
 *      no such warning fires, retained for robustness across 24 patches).
 *   3. Dispatch: `mcp` → startMcpServer() over stdio; otherwise → runCli(args).
 *
 * The runner fires ONLY inside the SEA binary (guarded by node:sea's isSea()); off-SEA
 * (npm/dev/test import) this module is inert, so cli.ts / server.ts keep their own bin
 * entry points. There is NO import.meta guard (it is false under SEA — design D4/D5).
 *
 * ADR-004: imports ONLY the CLI + MCP composition entry points + Node builtins.
 */

import { createRequire } from 'node:module';
import { runCli } from '../cli/cli.js';
import { startMcpServer } from '../mcp/server.js';

// Batch 0.2 EMPIRICAL FINDING (Node 24.18.0 win-x64): a SEA `process.argv` is
// [execPath, execPath, ...userArgs] — Node fills the argv[1] script slot with the
// executable path, so user args begin at index 2, IDENTICAL to `node <script> ...`.
// Design D5/Q3 assumed [execPath, ...args]/slice(1); the spike corrected the SEA
// offset to 2 (see design.md "Batch 0 — empirical findings"). Both offsets are 2;
// the isSea seam is retained for the documented contract and future divergence.
const SEA_ARGV_OFFSET = 2;
const NODE_ARGV_OFFSET = 2;

/** Dispatch plan produced by {@link planEntry}. */
export type EntryPlan =
  | { readonly mode: 'mcp' }
  | { readonly mode: 'cli'; readonly args: readonly string[] };

/**
 * PURE — unit-testable without spawning. Normalizes argv for the SEA vs node layout
 * and routes a leading `mcp` user arg to the MCP server, else to the CLI.
 *
 * @param argv  - the raw process.argv (NOT pre-sliced).
 * @param isSea - true inside the SEA binary.
 */
export function planEntry(argv: readonly string[], isSea: boolean): EntryPlan {
  const args = argv.slice(isSea ? SEA_ARGV_OFFSET : NODE_ARGV_OFFSET);
  return args[0] === 'mcp' ? { mode: 'mcp' } : { mode: 'cli', args };
}

/** Reads node:sea's isSea() via createRequire (no static node:sea type dependency). */
function detectSea(): boolean {
  try {
    const sea = createRequire(import.meta.url)('node:sea') as { isSea?: () => boolean };
    return typeof sea.isSea === 'function' ? sea.isSea() : false;
  } catch {
    return false;
  }
}

/**
 * Installs the Batch-0.4 defensive warning filter: swallows ONLY an ExperimentalWarning
 * whose message mentions sqlite, re-dispatching every other warning to Node's default
 * handlers so stderr stays clean without hiding unrelated warnings.
 */
function installSqliteWarningFilter(): void {
  const passthrough = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning: Error) => {
    if (warning.name === 'ExperimentalWarning' && /sqlite/i.test(warning.message)) {
      return; // swallow the node:sqlite experimental warning — stderr stays clean
    }
    for (const listener of passthrough) {
      (listener as (w: Error) => void)(warning);
    }
  });
}

/** Unconditional-in-the-binary runner: install the warning filter, then dispatch. */
function runSeaEntry(): void {
  installSqliteWarningFilter();
  const plan = planEntry(process.argv, true);

  if (plan.mode === 'mcp') {
    void startMcpServer().catch((err: unknown) => {
      console.error('Unexpected error:', err);
      process.exit(2);
    });
    return;
  }

  void runCli(plan.args)
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      console.error('Unexpected error:', err);
      process.exit(2);
    });
}

// Runs ONLY inside the SEA binary (isSea() true). Inert off-SEA / on import.
if (detectSea()) {
  runSeaEntry();
}
