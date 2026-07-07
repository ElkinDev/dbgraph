/**
 * asset-name — the release-asset mapping as a pure function (design D8/D11, phase-9.5c).
 *
 * `assetName(platform, arch)` is the SINGLE SOURCE OF TRUTH mapping a Node
 * `process.platform`/`process.arch` pair to the file name of the SEA binary published on
 * the GitHub Release. The two installers (install.ps1 / install.sh) REPLICATE this mapping
 * in their own shell dialects — this module is the reference the unit test pins so the
 * three stay in lock-step. The names MUST match what the build drivers emit:
 *   - build-sea.ps1 → dist/bin/dbgraph-win-x64.exe
 *   - build-sea.sh  → dist/bin/dbgraph-linux-x64
 *
 * Only win-x64 and linux-x64 are shipped this phase; an unsupported pair FAILS CLOSED
 * (throws) rather than guessing a name — a wrong asset name would download the wrong file
 * and defeat the checksum verification. macOS is dormant (release.yml carries the leg but
 * it is never built here — deferred to 9.5d).
 */

/**
 * The supported (platform-arch) → asset-name mapping. Keys are `${platform}-${arch}` using
 * Node's `process.platform` (`win32`, `linux`) and `process.arch` (`x64`) spellings.
 * @type {Readonly<Record<string, string>>}
 */
const ASSET_BY_TARGET = Object.freeze({
  'win32-x64': 'dbgraph-win-x64.exe',
  'linux-x64': 'dbgraph-linux-x64',
});

/**
 * Returns the published binary file name for a host platform/arch pair.
 *
 * @param {string} platform - a Node `process.platform` value (e.g. 'win32', 'linux').
 * @param {string} arch - a Node `process.arch` value (e.g. 'x64').
 * @returns {string} the release asset file name (e.g. 'dbgraph-win-x64.exe').
 * @throws {Error} when the platform/arch pair is not one of the shipped targets.
 */
export function assetName(platform, arch) {
  const target = `${platform}-${arch}`;
  const name = ASSET_BY_TARGET[target];
  if (name === undefined) {
    throw new Error(
      `Unsupported platform/arch: ${platform}/${arch}. ` +
        `Supported targets: win32/x64, linux/x64. ` +
        `(macOS and arm64 binaries are deferred to phase-9.5d.)`,
    );
  }
  return name;
}
