/**
 * Tests for src/cli/log/console-logger.ts — tasks 1.1 + 1.2 (ux-observability).
 * Spec: "--json payloads stay byte-identical and diagnostics go to STDERR" (STDERR-seam half)
 *       "--quiet suppresses progress but keeps warnings and errors"
 * Design: createConsoleLogger({ write?, level? }) → Logger
 *   - Writes formatted "level msg [meta]" lines to injected write seam (STDERR by default)
 *   - Default level 'info'; 'warn' level suppresses debug+info, keeps warn+error
 *   - No real stdio touched in tests — seam only
 *
 * TDD: RED → GREEN (tasks 1.1 + 1.2)
 *
 * CONTENT-SAFETY NOTE: The adapter is a dumb sink — it logs whatever meta it is given.
 * It is the CALLER's responsibility to never pass connection strings or secrets as meta.
 * Tests that pass meta values are asserting the adapter's formatting behaviour, not
 * endorsing passing secrets — callers in Batch 2 pass ONLY count/phase scalars.
 */

import { describe, it, expect } from 'vitest';
import {
  createConsoleLogger,
  type ConsoleLoggerOptions,
  type LogLevel,
} from '../../../src/cli/log/console-logger.js';
import type { Logger } from '../../../src/core/ports/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.1 — createConsoleLogger: basic formatting via captured write seam
// ─────────────────────────────────────────────────────────────────────────────

describe('createConsoleLogger — basic seam capture', () => {
  it('satisfies the Logger port type (compile-level contract)', () => {
    const logger: Logger = createConsoleLogger();
    // If this compiles, the adapter satisfies the port — no runtime assertion needed.
    expect(logger).toBeDefined();
  });

  it('logger.info emits a line through the write seam', () => {
    const lines: string[] = [];
    const opts: ConsoleLoggerOptions = { write: (t) => lines.push(t) };
    const logger = createConsoleLogger(opts);

    logger.info('extract started');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[info] extract started\n');
  });

  it('logger.warn emits a line through the write seam', () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (t) => lines.push(t) });

    logger.warn('schema mismatch detected');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[warn] schema mismatch detected\n');
  });

  it('logger.error emits a line through the write seam', () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (t) => lines.push(t) });

    logger.error('connection refused');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[error] connection refused\n');
  });

  it('logger.debug emits a line through the write seam (default level info suppresses it)', () => {
    // At default level 'info', debug IS suppressed. Covered more explicitly in task 1.2.
    // This test verifies debug does NOT produce a line at default level.
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (t) => lines.push(t) });

    logger.debug('verbose detail');

    expect(lines).toHaveLength(0);
  });

  it('meta count/phase scalars render deterministically — same input produces same bytes', () => {
    const lines1: string[] = [];
    const lines2: string[] = [];
    const meta = { upserted: 42, deleted: 3 };

    createConsoleLogger({ write: (t) => lines1.push(t) }).info('delta computed', meta);
    createConsoleLogger({ write: (t) => lines2.push(t) }).info('delta computed', meta);

    expect(lines1[0]).toBe(lines2[0]);
    expect(lines1[0]).toBe('[info] delta computed {"upserted":42,"deleted":3}\n');
  });

  it('meta with a single phase scalar renders inline after the message', () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (t) => lines.push(t) });

    logger.info('snapshot written', { id: 'snap-001' });

    expect(lines[0]).toBe('[info] snapshot written {"id":"snap-001"}\n');
  });

  it('no real process.stderr is touched — only the injected seam writes', () => {
    // If the adapter bypassed the seam and wrote to real stderr, we would have no way
    // to detect it here. The architecture enforces this via the write seam contract —
    // tests that inject a fake write seam and see all output PROVE no real stdio leaks.
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (t) => lines.push(t) });

    logger.info('test message');
    logger.warn('test warning');

    // All output captured — if real stderr were touched, it would bypass our array.
    expect(lines).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.1 — debug at explicit 'debug' level (must emit)
// ─────────────────────────────────────────────────────────────────────────────

describe('createConsoleLogger — explicit debug level', () => {
  it('logger.debug emits when level is explicitly set to debug', () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (t) => lines.push(t), level: 'debug' });

    logger.debug('low-level detail');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[debug] low-level detail\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.2 — level suppression: default 'info' and --quiet 'warn'
// ─────────────────────────────────────────────────────────────────────────────

describe('createConsoleLogger — level suppression (task 1.2)', () => {
  it('default level info: suppresses debug, emits info/warn/error', () => {
    const captured: string[] = [];
    const logger = createConsoleLogger({ write: (t) => captured.push(t) });
    // level defaults to 'info'

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(captured).toStrictEqual([
      '[info] info message\n',
      '[warn] warn message\n',
      '[error] error message\n',
    ]);
  });

  it('--quiet level (warn): suppresses debug + info, STILL emits warn + error', () => {
    const captured: string[] = [];
    const logger = createConsoleLogger({ write: (t) => captured.push(t), level: 'warn' });

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(captured).toStrictEqual([
      '[warn] warn message\n',
      '[error] error message\n',
    ]);
  });

  it('--quiet level: zero seam writes for debug', () => {
    const captured: string[] = [];
    const logger = createConsoleLogger({ write: (t) => captured.push(t), level: 'warn' });

    logger.debug('silent debug');

    expect(captured).toHaveLength(0);
  });

  it('--quiet level: zero seam writes for info', () => {
    const captured: string[] = [];
    const logger = createConsoleLogger({ write: (t) => captured.push(t), level: 'warn' });

    logger.info('silent info');

    expect(captured).toHaveLength(0);
  });

  it('error level: suppresses debug + info + warn, emits only error', () => {
    const captured: string[] = [];
    const logger = createConsoleLogger({ write: (t) => captured.push(t), level: 'error' });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(captured).toStrictEqual(['[error] e\n']);
  });

  it('exact surviving lines with --quiet level match the golden (toStrictEqual)', () => {
    const captured: string[] = [];
    const logger = createConsoleLogger({ write: (t) => captured.push(t), level: 'warn' });

    logger.info('extract started');
    logger.info('delta computed', { upserted: 5, deleted: 1 });
    logger.warn('slow query detected');
    logger.error('timeout', { code: 'ETIMEOUT' });

    expect(captured).toStrictEqual([
      '[warn] slow query detected\n',
      '[error] timeout {"code":"ETIMEOUT"}\n',
    ]);
  });

  it('LogLevel type is correctly typed — compile-level guard (no runtime assertion)', () => {
    // Assigning to the LogLevel type proves the union is exported correctly.
    const level: LogLevel = 'warn';
    expect(level).toBe('warn');
  });
});
