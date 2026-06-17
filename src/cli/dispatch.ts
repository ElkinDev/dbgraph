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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedArgs } from './parse/args.js';
import { runInit } from './commands/init.js';
import { runSync } from './commands/sync.js';
import { runStatus } from './commands/status.js';
import { parseConfig } from './config/parse-config.js';
import { resolveSecrets } from './config/resolve-secrets.js';
import {
  createSqliteSchemaAdapter,
  createMssqlSchemaAdapter,
  createSqliteGraphStore,
} from '../index.js';

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

  const { adapter, store } = await openAdapterAndStore(projectRoot);
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
async function handleStatus(_args: ParsedArgs): Promise<HandlerOutcome> {
  const projectRoot = process.cwd();

  const { adapter, store } = await openAdapterAndStore(projectRoot);
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
// ─────────────────────────────────────────────────────────────────────────────

type AdapterAndStore = {
  adapter: Awaited<ReturnType<typeof createSqliteSchemaAdapter>> | Awaited<ReturnType<typeof createMssqlSchemaAdapter>>;
  store: Awaited<ReturnType<typeof createSqliteGraphStore>>;
};

async function openAdapterAndStore(projectRoot: string): Promise<AdapterAndStore> {
  const configPath = join(projectRoot, 'dbgraph.config.json');
  const rawJson: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
  const cfg = parseConfig(rawJson);
  const resolved = resolveSecrets(cfg);

  const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });

  let adapter: Awaited<ReturnType<typeof createSqliteSchemaAdapter>> | Awaited<ReturnType<typeof createMssqlSchemaAdapter>>;

  if (resolved.dialect === 'sqlite') {
    adapter = await createSqliteSchemaAdapter({
      file: resolved.source.file,
      ...(resolved.driver !== undefined ? { driver: resolved.driver } : {}),
    });
  } else {
    const src = resolved.source;
    adapter = await createMssqlSchemaAdapter({
      server: src.server,
      ...(src.port !== undefined ? { port: parseInt(src.port, 10) } : {}),
      database: src.database,
      authentication: src.domain !== undefined
        ? { type: 'ntlm', domain: src.domain, user: src.user, password: src.password }
        : { type: 'sql', user: src.user, password: src.password },
    });
  }

  const store = await createSqliteGraphStore({ path: storePath });
  return { adapter, store };
}

async function handleQuery(_args: ParsedArgs): Promise<HandlerOutcome> {
  throw new Error('query handler not yet implemented — Batch E will fill this in');
}

async function handleExplore(_args: ParsedArgs): Promise<HandlerOutcome> {
  throw new Error('explore handler not yet implemented — Batch E will fill this in');
}

async function handleDiff(_args: ParsedArgs): Promise<HandlerOutcome> {
  throw new Error('diff handler not yet implemented — Batch F will fill this in');
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
