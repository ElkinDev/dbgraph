/**
 * profiles.ts — SqlcmdProfile registry for SQL Server connectivity.
 *
 * Encodes known sqlcmd variant/version quirks as DATA, not code branches.
 * Design Decision: "SqlcmdProfile registry is a data table in adapters".
 * Spec (US-040): "Variant/version profile registry encodes known quirks as data".
 *
 * F-3: Legacy sqlcmd 15.x flag mutual-exclusivities — -y 0 used ALONE (no -h/-W).
 * F-4: 2033-char chunk lines, NO column header, NO dashes separator.
 * F-5: -f o:65001 forces UTF-8 stdout codepage.
 * F-6: Reassembler must concatenate verbatim — no .trim() at chunk boundaries.
 *
 * Adding a new environment = adding one entry to SQLCMD_PROFILES.
 * No transport code changes required.
 *
 * ADR-004: this file lives in adapters territory; it may import core ports.
 * It MUST NOT import node:child_process or any driver.
 */

import type { ProbeResult } from '../../../../core/ports/capability-probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// SqlcmdProfile — the data shape for one known environment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Profile encoding a specific sqlcmd variant+version environment.
 *
 * Fields:
 *   variant      — tool variant identifier (e.g. 'legacy-odbc', 'go-sqlcmd')
 *   versionRange — human-readable version range (e.g. '15.x', '16.x', 'any')
 *   flags        — extra argv flags to append to the sqlcmd invocation
 *                  (EXACT array — no -h, no -W for legacy-15.x per F-3)
 *   outputShape  — describes the FOR JSON output format for this variant+version
 *   encoding     — Buffer decoding encoding for stdout (e.g. 'utf8')
 */
export interface SqlcmdProfile {
  /** Stable tool variant identifier, e.g. 'legacy-odbc', 'go-sqlcmd'. */
  readonly variant: string;
  /** Human-readable version range string, e.g. '15.x'. */
  readonly versionRange: string;
  /**
   * Extra argv flags to pass to sqlcmd for catalog/fingerprint invocations.
   * For legacy-15.x: ['-y', '0', '-f', 'o:65001'] — -y 0 alone (F-3).
   */
  readonly flags: readonly string[];
  /** Describes the FOR JSON output format emitted by this variant+version. */
  readonly outputShape: {
    /** Byte width of each FOR JSON chunk line (2033 for legacy-15.x — F-4). */
    readonly chunkSize: number;
    /**
     * Whether the output has a column-header line before the JSON data.
     * False for legacy-15.x with -y 0 and SET NOCOUNT ON (F-4).
     */
    readonly hasHeader: boolean;
  };
  /**
   * Node.js Buffer encoding for stdout.toString().
   * 'utf8' when -f o:65001 is in flags (F-5).
   */
  readonly encoding: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry — all known profiles as DATA rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known sqlcmd profiles, seeded with the measured legacy-15.x environment.
 *
 * Adding support for a new environment = adding a new entry here.
 * Transport code (sqlcmd.strategy.ts, json-rows.ts) reads the resolved profile
 * — it MUST NOT contain per-environment branches.
 */
export const SQLCMD_PROFILES: readonly SqlcmdProfile[] = [
  {
    // ── Legacy ODBC sqlcmd 15.x (e.g. v15.0.1300.23) ────────────────────────
    // Source: measured on sqlcmd 15.0.1300 (F-1..F-6 findings).
    // F-3: -y 0 is used ALONE — -h and -W are mutually exclusive with -y on 15.x.
    // F-4: No column header, no dashes separator; line 0 is JSON; 2033-char chunks.
    // F-5: -f o:65001 forces UTF-8 stdout codepage for correct non-ASCII handling.
    variant: 'legacy-odbc',
    versionRange: '15.x',
    flags: ['-y', '0', '-f', 'o:65001'],
    outputShape: { chunkSize: 2033, hasHeader: false },
    encoding: 'utf8',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Conservative default profile (for unrecognized environments)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conservative default profile returned when no registered entry matches.
 *
 * Uses the same flags as legacy-15.x (the ONLY measured environment) but
 * is not tied to a specific variant/version. On a miss, we make the safest
 * choice: the known-working set, with a conservative chunk size assumption.
 *
 * An unrecognized environment MUST NOT crash — the system degrades gracefully.
 */
const DEFAULT_PROFILE: SqlcmdProfile = {
  variant: 'unknown',
  versionRange: 'any',
  flags: ['-y', '0', '-f', 'o:65001'],
  outputShape: { chunkSize: 2033, hasHeader: false },
  encoding: 'utf8',
};

// ─────────────────────────────────────────────────────────────────────────────
// resolveProfile — select a profile from the registry based on ProbeResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the SqlcmdProfile for the given probe result.
 *
 * Matching algorithm:
 *   1. Extract the version string from the first sqlcmd CliToolInfo entry.
 *   2. For each registered profile (in order), check if the version matches
 *      the profile's versionRange (simple major-version prefix match).
 *   3. Return the first matching profile.
 *   4. If no entry matches → return DEFAULT_PROFILE (never throw).
 *
 * The conservative-default guarantee means an unrecognized environment
 * produces a profile, not an exception (US-040 requirement).
 */
export function resolveProfile(probe: ProbeResult): SqlcmdProfile {
  const sqlcmdTool = probe.cliTools.find((t) => t.tool === 'sqlcmd');
  const version = sqlcmdTool?.version ?? null;

  if (version !== null) {
    for (const profile of SQLCMD_PROFILES) {
      if (versionMatchesRange(version, profile.versionRange)) {
        return profile;
      }
    }
  }

  return DEFAULT_PROFILE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a detected version string matches a profile's versionRange.
 *
 * Range format (current):
 *   '<major>.x'  — matches any version whose major component equals <major>
 *   'any'        — always matches
 *
 * This simple strategy covers the current registry; more sophisticated semver
 * range matching can replace it when multi-major profiles are added.
 */
function versionMatchesRange(version: string, range: string): boolean {
  if (range === 'any') return true;

  const majorPattern = /^(\d+)\.x$/;
  const rangeMatch = majorPattern.exec(range);
  if (rangeMatch === null) return false;

  const expectedMajor = rangeMatch[1];
  const versionMajor = version.split('.')[0];

  return versionMajor === expectedMajor;
}
