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
import { parseMcpFlags, startHttpMcpServer, type McpTransportPlan } from '../mcp/http.js';
import { DbgraphError } from '../index.js';

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
  | { readonly mode: 'mcp'; readonly transport: McpTransportPlan }
  | { readonly mode: 'cli'; readonly args: readonly string[] };

/**
 * PURE — unit-testable without spawning. Normalizes argv for the SEA vs node layout
 * and routes a leading `mcp` user arg to the MCP server, else to the CLI.
 *
 * The `mcp` branch carries `transport: parseMcpFlags(argsAfter 'mcp')` (design D1): with
 * `--http` ABSENT it is `{ kind:'stdio' }` — today's byte-identical STDIO path — else an
 * `{ kind:'http', ... }` plan. May throw {@link ConfigError} on an invalid `--port`/`--host`
 * value; {@link runSeaEntry} catches it and exits 2 (the established exit-code contract).
 *
 * @param argv  - the raw process.argv (NOT pre-sliced).
 * @param isSea - true inside the SEA binary.
 */
export function planEntry(argv: readonly string[], isSea: boolean): EntryPlan {
  const args = argv.slice(isSea ? SEA_ARGV_OFFSET : NODE_ARGV_OFFSET);
  if (args[0] === 'mcp') {
    return { mode: 'mcp', transport: parseMcpFlags(args.slice(1)) };
  }
  return { mode: 'cli', args };
}

/**
 * Reads node:sea's isSea() via createRequire (no static node:sea type dependency).
 *
 * Base is process.execPath — NOT import.meta.url: in the esbuild CJS SEA bundle
 * import.meta.url is an empty shim (undefined), so createRequire(undefined) throws and
 * detectSea() would wrongly return false INSIDE the real SEA (the runner never fires,
 * empty program). process.execPath is a valid path in BOTH the SEA binary and the npm
 * ESM path, and node:sea is a builtin (the base only needs to be resolvable).
 */
function detectSea(): boolean {
  try {
    const sea = createRequire(process.execPath)('node:sea') as { isSea?: () => boolean };
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

  // planEntry → parseMcpFlags may throw ConfigError on an invalid --port/--host value.
  // Map it to exit 2 via the established DbgraphError → 2 contract (mirrors cli.ts),
  // with an actionable message on stderr instead of an unhandled exception.
  let plan: EntryPlan;
  try {
    plan = planEntry(process.argv, true);
  } catch (err: unknown) {
    if (err instanceof DbgraphError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  if (plan.mode === 'mcp') {
    // With --http ABSENT the transport is 'stdio' → startMcpServer() with no args, the
    // byte-identical STDIO path (design D1). With --http PRESENT → startHttpMcpServer(opts).
    const transport = plan.transport;
    if (transport.kind === 'http') {
      void startHttpMcpServer({
        host: transport.host,
        port: transport.port,
        quiet: transport.quiet,
      }).catch((err: unknown) => {
        console.error('Unexpected error:', err);
        process.exit(2);
      });
      return;
    }
    void startMcpServer().catch((err: unknown) => {
      console.error('Unexpected error:', err);
      process.exit(2);
    });
    return;
  }

  void runCli(plan.args)
    .then((code) => {
      // Set process.exitCode and let the event loop DRAIN instead of calling
      // process.exit(code) eagerly. Inside the SEA binary stdout is a pipe whose
      // writes are ASYNC; an eager process.exit() truncates them (observed: empty
      // stdout from `dbgraph --version` when piped). CLI handlers close their
      // store/adapter, so the loop empties and the process exits with this code
      // AFTER stdout has flushed. (The off-SEA npm path is unaffected — cli.ts keeps
      // its own runner; this is the SEA-only entry.)
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error('Unexpected error:', err);
      process.exitCode = 2;
    });
}

// Runs inside the SEA binary (isSea() true). Inert off-SEA / on import, so unit
// tests can import planEntry without spawning the CLI. The DBGRAPH_SEA_ENTRY=1
// escape hatch lets the off-SEA bundle sanity check (task 2.3: `node
// build/sea/dbgraph.cjs --version`) exercise the wired entry WITHOUT a real SEA;
// it is never set by tests or the npm/dev path, so those stay inert.
if (detectSea() || process.env['DBGRAPH_SEA_ENTRY'] === '1') {
  runSeaEntry();
}
