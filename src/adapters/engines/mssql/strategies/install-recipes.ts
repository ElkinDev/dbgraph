/**
 * install-recipes.ts — Official install recipe registry for MSSQL external tools.
 *
 * Maps a tool name (e.g. 'sqlcmd') to an ordered list of OFFICIAL install
 * instructions per OS. The registry contains ONLY references to official
 * Microsoft sources (winget package IDs or official Microsoft Learn URLs).
 *
 * Used by ConsentedInstallStrategy (B1 guided install) to print instructions
 * behind an explicit consent notice. No installer is ever executed automatically.
 *
 * B2 (automated installer execution) is NOT implemented here — it is DEFERRED
 * to a follow-up change. A clearly marked seam is left in ConsentedInstallStrategy.
 *
 * Spec cli-config "Guided install prints instructions only, never auto-executes".
 * connectivity-strategies Batch E, task E5.1.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The supported OS identifiers (matches Node's process.platform for win32/darwin/linux). */
export type RecipeOs = 'win32' | 'darwin' | 'linux';

/** The install method. */
export type RecipeMethod = 'winget' | 'brew' | 'url';

/**
 * A single official install recipe for a tool on a specific OS.
 *
 * - method 'winget': Windows Package Manager; `id` is the winget package id.
 * - method 'brew':   Homebrew; `id` is the tap/formula name.
 * - method 'url':    Direct download/docs URL from the official vendor.
 *
 * `url` is ALWAYS required — it links to official Microsoft documentation or
 * download page so the user can verify the source before proceeding.
 */
export interface InstallRecipe {
  readonly os: RecipeOs;
  readonly method: RecipeMethod;
  /** Package id (winget id or brew formula) — undefined for url-only recipes. */
  readonly id?: string;
  /** Official Microsoft URL (documentation or download page). ALWAYS present. */
  readonly url: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal registry: tool name → recipes per OS.
 * ONLY official Microsoft sources are registered here.
 */
const RECIPE_REGISTRY: Readonly<Record<string, readonly InstallRecipe[]>> = {
  /**
   * sqlcmd — Microsoft SQL Server command-line tool.
   *
   * go-sqlcmd is the modern cross-platform replacement for the legacy ODBC-based
   * sqlcmd. Official winget id: Microsoft.Sqlcmd.
   * Official docs: https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility
   */
  sqlcmd: [
    {
      os: 'win32',
      method: 'winget',
      id: 'Microsoft.Sqlcmd',
      url: 'https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility',
    },
    {
      os: 'darwin',
      method: 'brew',
      id: 'microsoft/mssql-release/sqlcmd',
      url: 'https://learn.microsoft.com/sql/linux/sql-server-linux-setup-tools',
    },
    {
      os: 'linux',
      method: 'url',
      url: 'https://learn.microsoft.com/sql/linux/sql-server-linux-setup-tools',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the ordered list of official install recipes for a given tool and OS.
 *
 * @param tool - The tool name (e.g. 'sqlcmd').
 * @param os   - The operating system (e.g. 'win32', 'darwin', 'linux').
 * @returns Matching InstallRecipe[] filtered to the given OS; empty if unknown.
 */
export function getRecipes(tool: string, os: RecipeOs | string): readonly InstallRecipe[] {
  const recipes = RECIPE_REGISTRY[tool];
  if (recipes === undefined) return [];
  return recipes.filter((r) => r.os === os);
}
