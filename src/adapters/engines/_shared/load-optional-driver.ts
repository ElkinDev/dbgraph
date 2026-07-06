/**
 * loadOptionalDriver — the centralized OPTIONAL-driver loading seam (design D7 / Q1).
 *
 * Purpose: make binary (SEA) driver resolution DETERMINISTIC and documented while
 * keeping the off-SEA (npm/dev) path byte-identical to today's `await import(name)`
 * — so every existing factory/strategy test + ADR-008 golden holds unchanged.
 *
 *   SEA branch  (sea.isSea()===true):
 *     ESM dynamic import() of a BARE specifier does NOT reliably walk CWD
 *     node_modules inside a SEA; `require`'s resolution IS well-defined and works.
 *     Resolve via createRequire with an explicit base — process.cwd() FIRST, then
 *     process.execPath — honoring $CWD/node_modules → NODE_PATH → global.
 *
 *   off-SEA branch (sea.isSea()===false):
 *     literally today's `await import(name)`.
 *
 * A resolution miss RETHROWS the original error, so each caller's EXISTING catch
 * still maps it to the established `Required driver '<name>' is not installed.
 * Run: npm i <name>` outcome (ADR-006 lazy/optional preserved).
 *
 * ADR-004: this is engine-shared adapter infrastructure — it never enters core.
 *
 * The isSea / createRequire / importModule seams are INJECTABLE so the branches
 * are unit-testable without a real SEA and without uninstalling a driver. The
 * default isSea reads `node:sea` via createRequire (NOT a static import) to avoid
 * a compile-time node:sea type dependency.
 */

import { createRequire as nodeCreateRequire } from 'node:module';
import { join } from 'node:path';

/**
 * A minimal require function shape — resolves a module id from a fixed base.
 * (The real Node require carries extra members; only the call is used here.)
 */
type RequireLike = (id: string) => unknown;

/**
 * Injectable seams for {@link loadOptionalDriver}. All optional — omit entirely
 * for production use.
 */
export interface LoadOptionalDriverDeps {
  /** Override the SEA detection (default: read `node:sea`.isSea via createRequire). */
  readonly isSea?: () => boolean;
  /** Override the require factory used by the SEA branch (default: node:module createRequire). */
  readonly createRequire?: (base: string) => RequireLike;
  /** Override the dynamic import used by the off-SEA branch (default: `import(name)`). */
  readonly importModule?: (name: string) => unknown | Promise<unknown>;
}

// Virtual anchor filename: createRequire resolves relative to the DIRECTORY of the
// given path, so a non-existent file inside cwd makes the CWD the resolution base.
const CWD_REQUIRE_ANCHOR = 'dbgraph-driver-resolver.js';

function defaultIsSea(): boolean {
  try {
    const req = nodeCreateRequire(join(process.cwd(), CWD_REQUIRE_ANCHOR));
    const sea = req('node:sea') as { isSea?: () => boolean };
    return typeof sea.isSea === 'function' ? sea.isSea() : false;
  } catch {
    // node:sea unavailable (older Node) → treat as not-a-SEA (npm/dev path).
    return false;
  }
}

const defaultCreateRequire = (base: string): RequireLike => {
  const req = nodeCreateRequire(base);
  return (id: string): unknown => req(id);
};

/**
 * Loads an OPTIONAL DB driver by package name, preserving ADR-006 lazy/optional
 * semantics. Returns the loaded module (namespace or CJS export object).
 *
 * @throws the driver's own resolution error on a miss — callers keep their
 *         existing catch → `Required driver '<name>' is not installed. Run: npm i <name>`.
 */
export async function loadOptionalDriver(
  name: string,
  deps: LoadOptionalDriverDeps = {},
): Promise<unknown> {
  const runningInSea = (deps.isSea ?? defaultIsSea)();

  if (runningInSea) {
    const makeRequire = deps.createRequire ?? defaultCreateRequire;

    // 1) resolve from the CWD ($CWD/node_modules → NODE_PATH → global)
    let cwdError: unknown;
    try {
      return makeRequire(join(process.cwd(), CWD_REQUIRE_ANCHOR))(name);
    } catch (err: unknown) {
      cwdError = err;
    }

    // 2) fall back to the executable's directory (exe-adjacent node_modules)
    try {
      return makeRequire(process.execPath)(name);
    } catch {
      // Resolution miss → rethrow the ORIGINAL cwd error so the caller's existing
      // catch produces the established `npm i <name>` outcome.
      throw cwdError;
    }
  }

  // off-SEA — byte-identical to today's `await import(name)`.
  const importModule = deps.importModule ?? ((n: string): Promise<unknown> => import(n));
  return await importModule(name);
}
