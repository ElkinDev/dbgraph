/**
 * Pure `--detail` validator — explore-payloads C.1 (design D4).
 * Spec: cli-config "explore and object reject an unknown --detail value".
 *
 * ONE pure validator reused by handleExplore / handleAffected / handleObject:
 * returns the value for the EXACT set brief|normal|full, defaults undefined → 'normal',
 * and THROWS a ConfigError naming the offending value for anything else. ConfigError is
 * the established DbgraphError subclass that maps to exit 2 (exit-code.ts). This replaces
 * the pre-change silent-coercion ternaries that turned garbage into 'normal' — a
 * correctness trap. One validator = one message shape, one unit test, three call sites.
 *
 * PURE: no I/O, no process access, deterministic (ADR-008).
 * ADR-004: imports ONLY the public barrel (src/index.ts) — no adapter/mcp imports.
 */

import { ConfigError } from '../../index.js';
import type { ExploreDetail } from '../../index.js';

/**
 * Validates a raw `--detail` flag value into an ExploreDetail.
 *
 * @param raw - The parsed flag value (`string` for `--detail x`, `true` for a bare
 *   `--detail`, `undefined` when the flag is absent).
 * @returns The detail level (`undefined` → `'normal'`).
 * @throws ConfigError naming the offending value when it is not one of brief|normal|full.
 */
export function parseDetail(raw: unknown): ExploreDetail {
  if (raw === undefined) {
    return 'normal';
  }
  if (raw === 'brief' || raw === 'normal' || raw === 'full') {
    return raw;
  }
  throw new ConfigError(
    `explore: "detail" must be one of brief|normal|full (got "${String(raw)}")`,
  );
}
