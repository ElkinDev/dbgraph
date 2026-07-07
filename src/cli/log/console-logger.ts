/**
 * Console Logger adapter — tasks 1.1 + 1.2 (ux-observability).
 * Spec: "--json payloads stay byte-identical and diagnostics go to STDERR"
 *       "--quiet suppresses progress but keeps warnings and errors"
 * Design Decision D1: Presentation adapter lives in src/cli (ADR-004).
 * Design Decision D2: Diagnostics → STDERR via injectable write seam (default: process.stderr.write).
 * Design Decision D7: Default level 'info'; '--quiet' callers pass level 'warn'.
 *
 * The adapter is a DUMB SINK — it formats whatever (msg, meta) it receives.
 * Content-safety is the CALLER's responsibility: callers MUST pass ONLY count/phase scalars.
 * The adapter never inspects, resolves, or derives values from config/secrets.
 *
 * No process.env, no Date.now(), no dynamic imports — pure deterministic formatter (ADR-008).
 * ADR-004: CLI-only; imports ONLY from core ports (public barrel) + node builtins.
 */

import type { Logger } from '../../core/ports/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Ordered severity levels — higher index = higher severity. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ConsoleLoggerOptions {
  /**
   * Write seam — receives each formatted line (including trailing '\n').
   * Default: process.stderr.write bound to process.stderr.
   * Inject a capturing fake in tests so no real stdio is touched.
   */
  write?: (text: string) => void;
  /**
   * Minimum severity level to emit.
   * Default: 'info' (suppresses debug).
   * Pass 'warn' for --quiet (suppresses debug + info).
   */
  level?: LogLevel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal constants
// ─────────────────────────────────────────────────────────────────────────────

/** Map from level string to numeric rank — higher rank = more severe. */
const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// createConsoleLogger — factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a Logger adapter that writes formatted diagnostic lines to the write seam.
 *
 * Line format:
 *   [level] msg\n              (no meta)
 *   [level] msg {json}\n       (with meta)
 *
 * Meta is serialised with JSON.stringify — deterministic for plain count/phase scalars.
 * Objects with cycles or non-serialisable values should NOT be passed (caller contract).
 */
export function createConsoleLogger(opts?: ConsoleLoggerOptions): Logger {
  const write: (text: string) => void =
    opts?.write ?? ((t) => { process.stderr.write(t); });

  const minLevel: LogLevel = opts?.level ?? 'info';
  const minRank = LEVEL_RANK[minLevel];

  function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < minRank) return;

    const metaPart =
      meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
    write(`[${level}] ${msg}${metaPart}\n`);
  }

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}
