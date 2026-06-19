/**
 * Command dispatch table — task 2.2 (phase-4-cli-config).
 * Design Decision 4: pure mapping from command name → handler reference.
 *
 * Unknown commands are RETURNED as a DispatchResult with type "unknown" —
 * never thrown as raw errors. The caller (cli.ts) decides exit code 2 + usage.
 *
 * Handlers THROW or RETURN — they NEVER call process.exit (keeps them testable).
 * Batch C wires the real init handler; later batches fill in sync/status/query/explore/diff.
 *
 * ADR-004: no adapter imports here — only types from this module.
 */

import type { ParsedArgs } from './parse/args.js';
import { runInit } from './commands/init.js';
import { runSync } from './commands/sync.js';
import { runStatus } from './commands/status.js';
import { runQuery } from './commands/query.js';
import { runExplore } from './commands/explore.js';
import { runDiff } from './commands/diff.js';
import { runAffected } from './commands/affected.js';
import { runInstall, realFsSeam } from './commands/install.js';
import { runDoctor } from './commands/doctor.js';
import { openConnections } from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Handler type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A command handler receives the full parsed args and returns a Promise.
 * It MUST throw a DbgraphError (or subclass) to signal failure — NEVER process.exit.
 * A handler returning void/undefined is treated as success (exit 0).
 * A handler returning { exitCode: 1 } signals a "negative" result (e.g. zero hits).
 */
export type CommandHandler = (args: ParsedArgs) => Promise<HandlerOutcome>;

/**
 * What a handler returns to tell cli.ts how to exit.
 * - { type: 'success' }          → exit 0
 * - { type: 'negative' }         → exit 1 (zero hits, no diff changes, etc.)
 * Errors are communicated via THROW, not return value.
 */
export type HandlerOutcome = { readonly type: 'success' } | { readonly type: 'negative' };

// ─────────────────────────────────────────────────────────────────────────────
// Discriminated union result
// ─────────────────────────────────────────────────────────────────────────────

export type DispatchResult =
  | { readonly type: 'handler'; readonly handler: CommandHandler }
  | { readonly type: 'unknown'; readonly command: string };

// ─────────────────────────────────────────────────────────────────────────────
// Stub handlers (later batches replace these with real implementations)
// ─────────────────────────────────────────────────────────────────────────────

async function handleInit(args: ParsedArgs): Promise<HandlerOutcome> {
  // Resolve project root: use cwd so the config is written to the project root.
  const projectRoot = process.cwd();

  // -i / --interactive flag: run the wizard
  if (args.flags['i'] === true || args.flags['interactive'] === true) {
    return runInit({ projectRoot, interactive: true });
  }

  // Flag form: extract connection fields from parsed flags
  const dialect = typeof args.flags['dialect'] === 'string' ? args.flags['dialect'] : '';
  if (dialect === 'sqlite') {
    const file = typeof args.flags['file'] === 'string' ? args.flags['file'] : '';
    const driver = args.flags['driver'];
    return runInit({
      projectRoot,
      dialect: 'sqlite',
      file,
      ...(driver === 'better-sqlite3' || driver === 'node:sqlite' ? { driver } : {}),
    });
  }

  if (dialect === 'mssql') {
    const server = typeof args.flags['server'] === 'string' ? args.flags['server'] : '';
    const database = typeof args.flags['database'] === 'string' ? args.flags['database'] : '';
    const user = typeof args.flags['user'] === 'string' ? args.flags['user'] : '';
    const password = typeof args.flags['password'] === 'string' ? args.flags['password'] : '';
    const port = typeof args.flags['port'] === 'string' ? args.flags['port'] : undefined;
    const domain = typeof args.flags['domain'] === 'string' ? args.flags['domain'] : undefined;

    return runInit({
      projectRoot,
      dialect: 'mssql',
      server,
      database,
      user,
      password,
      ...(port !== undefined ? { port } : {}),
      ...(domain !== undefined ? { domain } : {}),
    });
  }

  // No dialect or unrecognized — fall back to interactive wizard
  return runInit({ projectRoot, interactive: true });
}

/**
 * Opens adapter + store from the project config and runs sync.
 * --full flag forces a full re-extraction regardless of fingerprint.
 */
async function handleSync(args: ParsedArgs): Promise<HandlerOutcome> {
  const full = args.flags['full'] === true;
  const projectRoot = process.cwd();

  const { adapter, store } = await openConnections(projectRoot);
  try {
    return await runSync({ adapter, store, full });
  } finally {
    await adapter.close();
    await store.close();
  }
}

/**
 * Opens adapter + store from the project config and runs status.
 * Writes formatted output to stdout.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleStatus(_args: ParsedArgs): Promise<HandlerOutcome> {
  const projectRoot = process.cwd();

  const { adapter, store } = await openConnections(projectRoot);
  try {
    const result = await runStatus({ adapter, store });
    // Write to stdout (cli.ts owns process.exit but handlers own I/O)
    process.stdout.write(result.output);
    return { type: 'success' };
  } finally {
    await adapter.close();
    await store.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: open adapter + store from project config
// (delegates to src/cli/config/open-connections.ts — single source of truth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs search and prints text or JSON output.
 * Zero hits → 'negative' outcome (exit 1 per US-020 / Decision 9).
 */
async function handleQuery(args: ParsedArgs): Promise<HandlerOutcome> {
  const term = args.positionals[0] ?? '';
  const json = args.flags['json'] === true;
  const projectRoot = process.cwd();

  const { adapter, store } = await openConnections(projectRoot);
  try {
    const result = await runQuery({ store, term, json });
    process.stdout.write(result.output);
    return result;
  } finally {
    await adapter.close();
    await store.close();
  }
}

/**
 * Resolves qname → node + neighbors → formatExplore.
 * --detail defaults to 'normal'.
 */
async function handleExplore(args: ParsedArgs): Promise<HandlerOutcome> {
  const qname = args.positionals[0] ?? '';
  const detailRaw = args.flags['detail'];
  const detail =
    detailRaw === 'brief' || detailRaw === 'normal' || detailRaw === 'full'
      ? detailRaw
      : 'normal';
  const projectRoot = process.cwd();

  const { adapter, store } = await openConnections(projectRoot);
  try {
    const result = await runExplore({ store, qname, detail });
    process.stdout.write(result.output);
    return { type: 'success' };
  } finally {
    await adapter.close();
    await store.close();
  }
}

/**
 * Reads a .sql file, runs the precheck engine, prints text or JSON output.
 * Exit 1 when any graph objects are affected (CI change-detection gate, US-023).
 * Exit 0 when no graph objects matched.
 */
async function handleAffected(args: ParsedArgs): Promise<HandlerOutcome> {
  const sqlFile = args.positionals[0] ?? '';
  if (sqlFile === '') {
    throw new Error('dbgraph affected: <script.sql> argument is required');
  }
  const json = args.flags['json'] === true;
  const detailRaw = args.flags['detail'];
  const detail =
    detailRaw === 'brief' || detailRaw === 'normal' || detailRaw === 'full'
      ? detailRaw
      : 'normal';
  const projectRoot = process.cwd();

  const { adapter, store } = await openConnections(projectRoot);
  try {
    const result = await runAffected({ store, sqlFile, json, detail });
    process.stdout.write(result.output);
    return result;
  } finally {
    await adapter.close();
    await store.close();
  }
}

/**
 * Idempotently wires the dbgraph-mcp server entry into Claude Code's MCP config.
 * --remove undoes it. Prints manual snippet when no agent config is found.
 */
async function handleInstall(args: ParsedArgs): Promise<HandlerOutcome> {
  const remove = args.flags['remove'] === true;
  await runInstall({ remove, fs: realFsSeam });
  return { type: 'success' };
}

/**
 * Runs the content-free connectivity self-test (dbgraph doctor).
 * No DB connection opened — only capability probes are run stand-alone.
 * Writes the formatted report to stdout, returns success.
 * Always resolves — never throws (non-throwing per design).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleDoctor(_args: ParsedArgs): Promise<HandlerOutcome> {
  const projectRoot = process.cwd();

  // Determine the engine from config (optional — degrade gracefully when absent).
  let engine = 'mssql';
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parseConfig } = await import('../infra/config/parse-config.js');
    const configPath = join(projectRoot, 'dbgraph.config.json');
    const rawJson: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
    const cfg = parseConfig(rawJson);
    engine = cfg.dialect;
  } catch {
    // No config or unreadable config — default to 'mssql' (most probes applicable).
    // The doctor output will still be useful as a capability snapshot.
  }

  // Wire the appropriate probe for the detected engine.
  const probe = await buildProbe(engine);

  // Run doctor — non-throwing by contract.
  const output = await runDoctor({ engine, probe });

  process.stdout.write(output);
  return { type: 'success' };
}

/**
 * Builds the appropriate CapabilityProbe for the given engine.
 * All probe classes are imported via the public barrel (../index.js) — ADR-004
 * prohibits direct imports from src/adapters/** in src/cli/** files.
 *
 * Falls back to a no-op probe when the engine's probe class cannot be loaded.
 */
async function buildProbe(engine: string): Promise<() => Promise<import('../index.js').ProbeResult>> {
  try {
    // All imports go through the public barrel — never directly into /adapters/.
    const barrel = await import('../index.js');

    if (engine === 'mssql') {
      const probe = new barrel.MssqlCapabilityProbe();
      return () => probe.probe();
    }
    if (engine === 'pg') {
      const probe = new barrel.PgCapabilityProbe();
      return () => probe.probe();
    }
    if (engine === 'mysql') {
      const probe = new barrel.MysqlCapabilityProbe();
      return () => probe.probe();
    }
    if (engine === 'sqlite') {
      const probe = new barrel.SqliteCapabilityProbe();
      return () => probe.probe();
    }
  } catch {
    // Probe not available — fall through to no-op probe
  }

  // No-op fallback probe for unrecognized or probe-absent engines
  return async () => ({
    nativeDriver: false,
    cliTools: [],
    odbc: false,
  });
}

/**
 * Compares two snapshot manifests and returns the per-object diff.
 * --last: compare the two most-recent snapshots.
 * <snapA> <snapB>: compare explicit snapshot IDs.
 * Exit 0 when no changes, exit 1 when changes exist (CI-gate, Decision 9).
 */
async function handleDiff(args: ParsedArgs): Promise<HandlerOutcome> {
  const last = args.flags['last'] === true;
  const projectRoot = process.cwd();

  const { adapter, store } = await openConnections(projectRoot);
  try {
    let result;
    if (last) {
      result = await runDiff({ store, last: true });
    } else {
      const snapA = args.positionals[0] ?? '';
      const snapB = args.positionals[1] ?? '';
      result = await runDiff({ store, snapA, snapB });
    }
    process.stdout.write(result.output);
    return result;
  } finally {
    await adapter.close();
    await store.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch table
// ─────────────────────────────────────────────────────────────────────────────

const COMMAND_TABLE: Readonly<Record<string, CommandHandler>> = {
  init: handleInit,
  sync: handleSync,
  status: handleStatus,
  query: handleQuery,
  explore: handleExplore,
  diff: handleDiff,
  affected: handleAffected,
  install: handleInstall,
  doctor: handleDoctor,
};

/**
 * Looks up the handler for the given command name.
 * Returns { type: 'handler', handler } for known commands.
 * Returns { type: 'unknown', command } for unknown commands — no throw.
 */
export function dispatch(command: string): DispatchResult {
  const handler = COMMAND_TABLE[command];
  if (handler !== undefined) {
    return { type: 'handler', handler };
  }
  return { type: 'unknown', command };
}
