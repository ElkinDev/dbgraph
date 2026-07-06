/**
 * Unit tests for assetName — the pure release-asset mapping (design D8/D11, phase-9.5c).
 *
 * This is the (vitest) half of Batch 4: `assetName(platform, arch)` is a PURE function
 * asserted here in `npm test` with NO binary and NO release fired (D12). It is the SHARED
 * CONTRACT the two installers (install.ps1 / install.sh) replicate — the reference mapping
 * from a Node `process.platform`/`process.arch` pair to the built binary's file name, which
 * MUST match the names emitted by build-sea.ps1 (`dbgraph-win-x64.exe`) and build-sea.sh
 * (`dbgraph-linux-x64`) so the installer downloads the right asset + checksum.
 *
 * Pins (spec R5 "Fetch is parameterized by version and platform", asset half):
 *   - win32/x64 → dbgraph-win-x64.exe   (native Windows build, .exe extension)
 *   - linux/x64 → dbgraph-linux-x64     (Docker glibc build, no extension)
 *   - any other pair → throws (fail closed on an unsupported host; win-x64 + linux-x64
 *     are the only assets this phase ships; macOS is dormant, deferred to 9.5d).
 *
 * TDD: RED (scripts/install/asset-name.mjs does not exist yet) → GREEN.
 */

import { describe, it, expect } from 'vitest';
// Typed via scripts/install/asset-name.d.mts (build/install tooling; not part of the shipped package).
import { assetName } from '../../scripts/install/asset-name.mjs';

describe('assetName — the release asset mapping (spec R5)', () => {
  it('maps win32/x64 to dbgraph-win-x64.exe (matches build-sea.ps1 output)', () => {
    expect(assetName('win32', 'x64')).toBe('dbgraph-win-x64.exe');
  });

  it('maps linux/x64 to dbgraph-linux-x64 (matches build-sea.sh output)', () => {
    expect(assetName('linux', 'x64')).toBe('dbgraph-linux-x64');
  });

  it('throws on an unsupported platform (darwin is dormant — deferred to 9.5d)', () => {
    expect(() => assetName('darwin', 'x64')).toThrow(/unsupported/i);
  });

  it('throws on an unsupported arch (arm64 not shipped this phase)', () => {
    expect(() => assetName('linux', 'arm64')).toThrow(/unsupported/i);
  });

  it('the thrown message names the offending platform/arch pair (actionable)', () => {
    expect(() => assetName('freebsd', 'x64')).toThrow(/freebsd/);
  });
});
