/**
 * Version single-source drift guard — the load-bearing release invariant (phase-9.5d-release).
 *
 * The application resolves its version through TWO channels that read DIFFERENT sources:
 *   - npm `dist` channel: `dist/cli.js` falls back to the `DBGRAPH_VERSION` constant
 *     (`src/index.ts`) when `DBGRAPH_BUILD_VERSION` is unset.
 *   - SEA-binary channel: esbuild `define` BAKES `package.json.version` into
 *     `DBGRAPH_BUILD_VERSION`.
 * If those two literals ever drift apart, one channel ships a different version than the
 * other — and the classic failure mode is bumping `package.json` while `DBGRAPH_VERSION`
 * still reports `0.0.0` on the npm channel.
 *
 * This guard reads FILES ONLY (the source constant + `package.json` on disk) — NO build
 * artifact — so it runs UNCONDITIONALLY in `npm test` (no `skipIf`). The triple-equality
 * `pkg.version === DBGRAPH_VERSION === '1.1.0'` makes divergence mechanically impossible to
 * ship: bump one source without the other and this test goes RED before anything is packed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DBGRAPH_VERSION } from '../../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
  version: string;
};

describe('version single-source drift guard (always-on)', () => {
  it('package.json.version equals the DBGRAPH_VERSION source constant', () => {
    // If either literal is bumped without the other, this equality breaks (RED).
    expect(pkg.version).toBe(DBGRAPH_VERSION);
  });

  it('the single version value is exactly "1.1.0"', () => {
    // Pins the current release value so both channels report 1.1.0.
    expect(DBGRAPH_VERSION).toBe('1.1.0');
  });
});
