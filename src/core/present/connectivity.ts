/**
 * formatOutcome — task 1.3 (resilient-connectivity Batch 1).
 * Spec: connectivity-diagnostics "Connection failure yields a typed non-blocking outcome
 *   presenting at least three options".
 * Design: PURE; ConnectivityOutcome; engine + content-free summary, each attempt
 *   (id — reason), ALL >= 3 options rendered deterministically.
 *
 * ADR-004: imports ONLY core types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (ConnectivityOutcome) → byte-identical string.
 *
 * Mirrors the SHAPE of present/status.ts: lines[], push, join('\n') + '\n'.
 *
 * Rendering contract per option kind:
 *   run-it-yourself   — prints each query verbatim (paste-able, write-verb-free)
 *   consented-install — prints tool + docUrl + explicit CONSENT notice (no auto-install)
 *   manual-dump       — prints outputPath
 */

import type { ConnectivityOutcome, ConnectivityOption } from '../errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// formatOutcome — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a ConnectivityOutcome into a human-readable string.
 *
 * Output contract (ADR-008):
 *   - Same (outcome) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatOutcome(outcome: ConnectivityOutcome): string {
  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push('CONNECTIVITY UNAVAILABLE');
  lines.push('─'.repeat(40));
  lines.push(`  Engine:   ${outcome.engine}`);
  lines.push(`  Summary:  ${outcome.summary}`);

  // ── Attempts ───────────────────────────────────────────────────────────────
  if (outcome.attempts.length > 0) {
    lines.push('');
    lines.push('  Attempts:');
    for (const attempt of outcome.attempts) {
      lines.push(`    ${attempt.id} — ${attempt.reason}`);
    }
  }

  // ── Options ────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('  Options:');
  lines.push('  ─'.repeat(20));

  for (let i = 0; i < outcome.options.length; i++) {
    const option = outcome.options[i];
    if (option === undefined) continue;
    lines.push('');
    lines.push(`  Option ${(i + 1).toString()} — ${formatOptionHeader(option)}`);
    formatOptionBody(option, lines);
  }

  lines.push('');
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatOptionHeader(option: ConnectivityOption): string {
  switch (option.kind) {
    case 'run-it-yourself':
      return 'Run it yourself';
    case 'consented-install':
      return 'Consented install';
    case 'manual-dump':
      return 'Manual dump import';
  }
}

function formatOptionBody(option: ConnectivityOption, lines: string[]): void {
  switch (option.kind) {
    case 'run-it-yourself': {
      lines.push(`    Run these read-only SELECT statements in your own client:`);
      for (const query of option.queries) {
        lines.push(`    ${query}`);
      }
      break;
    }
    case 'consented-install': {
      lines.push(`    Tool:    ${option.tool}`);
      lines.push(`    Docs:    ${option.docUrl}`);
      lines.push(`    CONSENT: This option installs a package only after EXPLICIT user consent.`);
      lines.push(`             No installation has been performed.`);
      break;
    }
    case 'manual-dump': {
      lines.push(`    Path:    ${option.outputPath}`);
      lines.push(`    Produce a JSON dump externally and place it at the path above.`);
      break;
    }
  }
}
