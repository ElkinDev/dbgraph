/**
 * doctor command — task 5.2 (resilient-connectivity Batch 5).
 * Spec (US-043): connectivity-diagnostics "dbgraph doctor reports diagnostics content-free".
 * Design: runDoctor(deps) runs the per-engine CapabilityProbe(s) stand-alone
 *   (inject the probe seam — NO real DB), resolves the profile NAME via resolveProfile,
 *   derives the chosen-strategy id WITHOUT connecting, builds a DoctorView,
 *   and returns the formatDoctor output string.
 *
 * NON-throwing: an unrecognized-environment probe (no profile match, probe error)
 *   → a report noting the unrecognized environment (shape sample only), NO exception.
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + adapter probe files
 *   and profiles module (adapter territory — permitted from cli via barrel re-export
 *   or direct import since cli orchestrates the whole).
 *
 * Boundaries:
 *   - NO DB connection opened
 *   - NO catalog SELECT issued
 *   - NO schema/identifier/secret in the output
 */

import { formatDoctor, resolveProfile } from '../../index.js';
import type { DoctorView, ProbeResult } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable dependency bundle for runDoctor.
 * All fields are required — inject a probe seam in tests (NO real DB).
 */
export interface RunDoctorDeps {
  /** The engine identifier (e.g. 'mssql', 'pg', 'mysql', 'sqlite'). */
  readonly engine: string;
  /**
   * The capability probe function.
   * MUST resolve (never reject) in production — but runDoctor wraps it
   * in a try/catch to degrade gracefully even if the seam throws.
   */
  readonly probe: () => Promise<ProbeResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback probe result (used when the probe itself throws)
// ─────────────────────────────────────────────────────────────────────────────

const UNAVAILABLE_PROBE: ProbeResult = {
  nativeDriver: false,
  cliTools: [],
  odbc: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// runDoctor — stand-alone diagnostic runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the per-engine capability probe stand-alone (no DB connection, no catalog),
 * resolves the profile and strategy, assembles a content-free DoctorView, and
 * returns the formatted string via formatDoctor.
 *
 * NON-throwing: any probe failure degrades to an "unavailable" report.
 * Content-free: the returned string contains only capability shape data —
 *   no schema names, object identifiers, or secrets.
 */
export async function runDoctor(deps: RunDoctorDeps): Promise<string> {
  const { engine, probe } = deps;

  // Run the probe — degrade gracefully if it throws (probe must not throw in
  // production, but the doctor command is explicitly non-throwing).
  let probeResult: ProbeResult;
  try {
    probeResult = await probe();
  } catch {
    probeResult = UNAVAILABLE_PROBE;
  }

  // Resolve profile and strategy — engine-specific logic
  const { resolvedProfile, chosenStrategy } = resolveProfileAndStrategy(engine, probeResult);

  // Build the content-free DoctorView
  const view: DoctorView = {
    engine,
    nativeDriver: probeResult.nativeDriver,
    cliTools: probeResult.cliTools,
    odbc: probeResult.odbc,
    resolvedProfile,
    chosenStrategy,
  };

  // Render via the pure formatter — NEVER throws
  return formatDoctor(view);
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile + strategy resolution — engine-specific, no DB connection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the profile name and chosen strategy id from the probe result.
 * Completely synchronous, no I/O.
 *
 * Strategy selection algorithm (no-connection, no catalog):
 *   mssql: prefer sqlcmd (if on PATH) → odbc (if driver present) → native (if tedious present) → unavailable
 *   pg:    prefer native-pg (if pg present) → unavailable
 *   mysql: prefer native-mysql2 (if mysql2 present) → unavailable
 *   sqlite: prefer native-better-sqlite3/node:sqlite (if present) → unavailable
 *   other: unavailable
 */
function resolveProfileAndStrategy(
  engine: string,
  probe: ProbeResult,
): { resolvedProfile: string; chosenStrategy: string } {
  if (engine === 'mssql') {
    // Use the SqlcmdProfile registry for mssql
    const profile = resolveProfile(probe);
    const profileName = `${profile.variant}@${profile.versionRange}`;

    // Strategy selection: sqlcmd > odbc > native > unavailable
    let chosenStrategy: string;
    const sqlcmdTool = probe.cliTools.find((t) => t.tool === 'sqlcmd');
    if (sqlcmdTool?.path !== null && sqlcmdTool?.path !== undefined) {
      chosenStrategy = 'sqlcmd';
    } else if (probe.odbc) {
      chosenStrategy = 'odbc';
    } else if (probe.nativeDriver) {
      chosenStrategy = 'native-tedious';
    } else {
      chosenStrategy = 'unavailable';
    }

    return { resolvedProfile: profileName, chosenStrategy };
  }

  if (engine === 'pg') {
    const chosenStrategy = probe.nativeDriver ? 'native-pg' : 'unavailable';
    return { resolvedProfile: 'n/a', chosenStrategy };
  }

  if (engine === 'mysql') {
    const chosenStrategy = probe.nativeDriver ? 'native-mysql2' : 'unavailable';
    return { resolvedProfile: 'n/a', chosenStrategy };
  }

  if (engine === 'sqlite') {
    const chosenStrategy = probe.nativeDriver ? 'native-sqlite' : 'unavailable';
    return { resolvedProfile: 'n/a', chosenStrategy };
  }

  // Unrecognized engine — degrade gracefully
  return { resolvedProfile: 'unknown@any', chosenStrategy: 'unavailable' };
}
