#!/usr/bin/env node
/**
 * CLI entry point — task 2.4 (phase-4-cli-config).
 * Design Decision 8 (shebang, ESM-only, two-entry tsup build) +
 * Design Decision 9 (exit-code map centralised here).
 *
 * Flow: parseArgv → dispatch → run handler → exitCodeFor → process.exit.
 * Commands THROW DbgraphErrors or RETURN HandlerOutcome — never process.exit themselves.
 * This is the ONLY process.exit site in the codebase.
 *
 * ADR-004: imports ONLY from src/index.ts (public barrel) + Node builtins.
 */

import { parseArgv } from './parse/args.js';
import { dispatch } from './dispatch.js';
import { exitCodeFor } from './exit-code.js';
import { DbgraphError, ConnectivityUnavailableError, formatOutcome, DBGRAPH_VERSION } from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Usage text (also tested in unit tests — exported for testability)
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_TEXT = `
dbgraph — database schema graph indexer

Usage: dbgraph <command> [options]

Commands:
  init      Initialize the graph index for a database
  sync      Synchronize the graph index with the database
  status    Show the current state of the graph index
  query     Search the graph index for a term
  explore   Explore a node and its neighbors in the graph
  diff      Compare two snapshots of the graph index
  affected  Analyze DDL to show impacted objects (--json for machine output)
  install   Wire dbgraph-mcp into supported MCP agents (--remove to undo)
  doctor    Run a content-free connectivity self-test (safe to share)

Options:
  --help, -h       Show this help text
  --version, -v    Print the dbgraph version and exit

Run "dbgraph <command> --help" for command-specific options.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Main runner (exported for integration tests and future testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the CLI from the given argv slice.
 * Does NOT call process.exit — returns the exit code instead.
 * Callers (or the __main block below) call process.exit with the returned code.
 *
 * @param argv - process.argv.slice(2)
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);

  // --help at the top level (before or instead of a command)
  if (parsed.flags['help'] === true || parsed.flags['h'] === true) {
    process.stdout.write(USAGE_TEXT + '\n');
    return 0;
  }

  // --version/-v at the top level (design D6, phase-9.5c). Handles both the
  // command position (`dbgraph --version` → parseArgv makes it the command) and
  // the flag position. The value is baked at bundle time via esbuild `define`
  // (process.env.DBGRAPH_BUILD_VERSION) so the binary answers with NO disk read;
  // off-SEA the env var is undefined → falls back to DBGRAPH_VERSION.
  if (
    parsed.command === '--version' ||
    parsed.command === '-v' ||
    parsed.flags['version'] === true ||
    parsed.flags['v'] === true
  ) {
    process.stdout.write((process.env['DBGRAPH_BUILD_VERSION'] ?? DBGRAPH_VERSION) + '\n');
    return 0;
  }

  const dispatchResult = dispatch(parsed.command);

  if (dispatchResult.type === 'unknown') {
    process.stderr.write(`Unknown command: "${parsed.command}"\n\n${USAGE_TEXT}\n`);
    return exitCodeFor({ type: 'unknownCommand', command: parsed.command });
  }

  try {
    const outcome = await dispatchResult.handler(parsed);
    return exitCodeFor(outcome);
  } catch (err: unknown) {
    if (err instanceof ConnectivityUnavailableError) {
      // Render the structured outcome via the pure formatter — no raw stack trace.
      process.stderr.write(formatOutcome(err.outcome) + '\n');
      return exitCodeFor(err);
    }
    if (err instanceof DbgraphError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return exitCodeFor(err);
    }
    // Unexpected (non-DbgraphError) error — re-throw so Node prints the stack
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point (only runs when executed directly — skipped during imports)
// ─────────────────────────────────────────────────────────────────────────────

// Detect whether this module is being run directly.
// In ESM there is no require.main; we compare import.meta.url to process.argv[1].
import { pathToFileURL } from 'node:url';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      console.error('Unexpected error:', err);
      process.exit(2);
    });
}
