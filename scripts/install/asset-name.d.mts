/**
 * Type declarations for asset-name.mjs (install/build tooling; not part of the shipped
 * package). Lets the unit test consume the mapping with real types — no `any`, strict.
 * Kept in sync with asset-name.mjs manually.
 */

/**
 * Returns the published binary file name for a host `process.platform`/`process.arch` pair.
 * @throws when the platform/arch pair is not a shipped target (win32/x64, linux/x64).
 */
export function assetName(platform: string, arch: string): string;
