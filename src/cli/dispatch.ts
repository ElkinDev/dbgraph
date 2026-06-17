/**
 * Command dispatch table — task 2.2 (phase-4-cli-config).
 * Design Decision 4: pure mapping from command name → handler reference.
 *
 * Unknown commands are RETURNED as a DispatchResult with type "unknown" —
 * never thrown as raw errors. The caller (cli.ts) decides exit code 2 + usage.
 *
 * Handlers are stub functions for now; later batches (C, D, E) will fill them in.
 * Handlers THROW or RETURN — they NEVER call process.exit (keeps them testable).
 *
 * ADR-004: no adapter imports here — only types from this module.
 */

import type { ParsedArgs } from './parse/args.js';

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

async function handleInit(_args: ParsedArgs): Promise<HandlerOutcome> {
  throw new Error('init handler not yet implemented — Batch C will fill this in');
}

async function handleSync(_args: ParsedArgs): Promise<HandlerOutcome> {
  throw new Error('sync handler not yet implemented — Batch D will fill this in');
}

async function handleStatus(_args: ParsedArgs): Promise<HandlerOutcome> {
  throw new Error('status handler not yet implemented — Batch D will fill this in');
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
