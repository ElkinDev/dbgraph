/**
 * formatDoctor — task 5.1 (resilient-connectivity Batch 5).
 * Spec (US-043): connectivity-diagnostics "dbgraph doctor reports diagnostics content-free".
 * Design: PURE; DoctorView; engine, native-driver bool, CLI tools + versions,
 *   ODBC bool, resolved profile NAME, chosen-strategy id — SHAPE ONLY.
 *   ZERO schema / identifier / secret.
 *
 * ADR-004: imports ONLY core types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (DoctorView) → byte-identical string.
 *
 * Mirrors the SHAPE of present/status.ts: lines[], push, join('\n') + '\n'.
 *
 * Content-free contract:
 *   The renderer surfaces ONLY the capability-shape fields from DoctorView.
 *   No schema names, object identifiers, connection-string values, or secrets
 *   are ever surfaced — the output is safe to paste into a bug report.
 */

import type { CliToolInfo } from '../ports/capability-probe.js';

/**
 * Host-independent basename: the last segment after EITHER a forward slash or a
 * backslash. node:path.basename only recognizes the host OS separator, so on
 * Linux it would leave a Windows path (and its embedded username) fully intact —
 * the exact cross-platform leak this guards against. Splitting on both separators
 * yields byte-identical results on every OS.
 */
function lastPathSegment(p: string): string {
  const segments = p.split(/[\\/]/).filter((s) => s.length > 0);
  return segments.length > 0 ? (segments[segments.length - 1] as string) : 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input bundle for formatDoctor — a content-free capability snapshot.
 *
 * Fields contain SHAPE data only (booleans, version strings, profile names,
 * strategy ids) — never schema names, object identifiers, or secrets.
 */
export interface DoctorView {
  /** Engine identifier (e.g. 'mssql', 'pg', 'mysql', 'sqlite'). */
  readonly engine: string;
  /**
   * Whether the native driver package is importable in the current environment.
   * True = driver present; false = absent.
   */
  readonly nativeDriver: boolean;
  /**
   * Detected CLI tools (e.g. sqlcmd, psql, mysql).
   * Each entry carries the tool name, detected version (null if absent), and
   * resolved PATH (null if absent).
   */
  readonly cliTools: readonly CliToolInfo[];
  /**
   * Whether an ODBC driver for this engine is registered in the OS.
   * Always false for pg/mysql/sqlite (N/A).
   */
  readonly odbc: boolean;
  /**
   * The resolved profile name from the strategy registry.
   * 'n/a' when no profile registry exists for this engine.
   * 'unknown@any' when no matching profile was found (conservative default).
   */
  readonly resolvedProfile: string;
  /**
   * The chosen (or recommended) strategy id.
   * 'unavailable' when no strategy can be selected.
   */
  readonly chosenStrategy: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatDoctor — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a DoctorView into a human-readable, content-free diagnostic string.
 *
 * Output contract (ADR-008):
 *   - Same (view) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 *   - CONTENT-FREE: only capability booleans, version strings, profile names,
 *     and strategy ids are emitted — no schema/identifier/secret
 */
export function formatDoctor(view: DoctorView): string {
  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push('DBGRAPH DOCTOR');
  lines.push('─'.repeat(40));
  lines.push(`  Engine:            ${view.engine}`);

  // ── Native driver ──────────────────────────────────────────────────────────
  lines.push(`  Native driver:     ${view.nativeDriver ? 'present (true)' : 'absent (false)'}`);

  // ── CLI tools ──────────────────────────────────────────────────────────────
  if (view.cliTools.length === 0) {
    lines.push('  CLI tools:         (none)');
  } else {
    lines.push('  CLI tools:');
    for (const tool of view.cliTools) {
      const versionPart = tool.version !== null ? tool.version : 'not detected';
      // S1 (R1 remediation): render BASENAME only — never the full path, which
      // can embed a username (e.g. C:\Users\ecardoso\...). lastPathSegment is
      // host-independent (handles BOTH separators) — node:path.basename is not.
      const pathPart = tool.path !== null ? lastPathSegment(tool.path) : 'not found';
      lines.push(`    ${tool.tool.padEnd(12)}  version: ${versionPart}  path: ${pathPart}`);
    }
  }

  // ── ODBC ───────────────────────────────────────────────────────────────────
  lines.push(`  ODBC:              ${view.odbc ? 'present (true)' : 'absent (false)'}`);

  // ── Profile + strategy ─────────────────────────────────────────────────────
  lines.push('');
  lines.push('  Resolved profile:  ' + view.resolvedProfile);
  lines.push('  Chosen strategy:   ' + view.chosenStrategy);

  lines.push('');
  return lines.join('\n') + '\n';
}
