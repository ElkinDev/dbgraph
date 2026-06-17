/**
 * Exit-code mapper — task 2.3 (phase-4-cli-config).
 * Design Decision 9 (phase-4-cli-config):
 *
 *   0  success (HandlerOutcome { type: 'success' })
 *   1  negative result (HandlerOutcome { type: 'negative' }) — zero hits / diff has changes
 *   2  ConnectionError + unknown command + ConfigError + any other DbgraphError
 *   3  PermissionError (names exact missing permission)
 *   4  UnsupportedDialectError (lists available dialects)
 *
 * PURE function: no I/O, no process access. cli.ts is the ONLY process.exit site.
 * ADR-004: imports ONLY from src/index.ts (public barrel) + handler types.
 */

import {
  ConnectionError,
  PermissionError,
  UnsupportedDialectError,
  DbgraphError,
} from '../index.js';
import type { HandlerOutcome } from './dispatch.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input union — everything cli.ts can hand to this mapper
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel for an unknown command (dispatch returned type:'unknown'). */
export interface UnknownCommandInput {
  readonly type: 'unknownCommand';
  readonly command: string;
}

/**
 * Everything the exit-code mapper accepts.
 * - HandlerOutcome — normal success/negative returns from a handler
 * - UnknownCommandInput — cli.ts got dispatch type:'unknown'
 * - DbgraphError (or any subclass) — handler threw a typed error
 */
export type ExitCodeInput = HandlerOutcome | UnknownCommandInput | DbgraphError;

// ─────────────────────────────────────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps an outcome or error to a stable CLI exit code.
 *
 * @param input - A HandlerOutcome, UnknownCommandInput, or a DbgraphError subclass.
 * @returns The exit code (0, 1, 2, 3, or 4).
 */
export function exitCodeFor(input: ExitCodeInput): 0 | 1 | 2 | 3 | 4 {
  // ── DbgraphError subclasses (thrown by handlers) ──────────────────────────
  if (input instanceof DbgraphError) {
    if (input instanceof PermissionError) return 3;
    if (input instanceof UnsupportedDialectError) return 4;
    // ConnectionError, ConfigError, SchemaVersionError, StorageError, and
    // any other DbgraphError all map to 2.
    if (input instanceof ConnectionError) return 2;
    return 2;
  }

  // ── Normal handler outcomes and dispatch results ───────────────────────────
  const typed = input as HandlerOutcome | UnknownCommandInput;

  switch (typed.type) {
    case 'success':
      return 0;
    case 'negative':
      return 1;
    case 'unknownCommand':
      return 2;
  }
}
