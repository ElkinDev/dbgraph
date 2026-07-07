/**
 * Task 3.8 (source-level) — RED→GREEN: the viz assets are EMBEDDED as inlinable string
 * constants, so they ship inside both the npm `dist` bundle and the SEA blob (ADR-010) and
 * `handleViz` assembles the HTML with NO runtime filesystem read.
 *
 * This is the fast, `npm test`-resident proof that the assets are "present in the bundled
 * blob, not read from disk": the embedded constants are byte-identical to the on-disk asset
 * source of truth (a drift guard), and are reachable from the CLI import graph that
 * `sea-entry.ts` bundles — so esbuild string-inlines them into `build/sea/dbgraph.cjs`. The
 * ARTIFACT-level scan of the built bundle is the release smoke (bundle-external pattern).
 *
 * L-009: toBe / toStrictEqual byte compares, no `.toBeDefined()`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VIZ_TEMPLATE_HTML,
  VIZ_VIEWER_CSS,
  VIZ_VIEWER_JS,
  VIZ_VENDOR_JS,
} from '../../../src/cli/commands/viz/assets/embedded.generated.js';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', '..', '..', 'src', 'cli', 'commands', 'viz', 'assets');
const vendorDir = join(assetsDir, 'vendor');
const read = (p: string): string => readFileSync(p, 'utf-8');

// d3-force needs quadtree/dispatch/timer on the global `d3` first (UMD load order).
const VENDOR_ORDER = ['d3-dispatch.js', 'd3-quadtree.js', 'd3-timer.js', 'd3-force.js'];

describe('embedded viz assets are byte-identical to the on-disk source (task 3.8 drift guard)', () => {
  it('VIZ_TEMPLATE_HTML === template.html', () => {
    expect(VIZ_TEMPLATE_HTML).toBe(read(join(assetsDir, 'template.html')));
  });

  it('VIZ_VIEWER_CSS === viewer.css', () => {
    expect(VIZ_VIEWER_CSS).toBe(read(join(assetsDir, 'viewer.css')));
  });

  it('VIZ_VIEWER_JS === viewer.js', () => {
    expect(VIZ_VIEWER_JS).toBe(read(join(assetsDir, 'viewer.js')));
  });

  it('VIZ_VENDOR_JS === the 4 vendored d3 files concatenated in UMD load order', () => {
    const expected = VENDOR_ORDER.map((f) => read(join(vendorDir, f))).join('\n');
    expect(VIZ_VENDOR_JS).toBe(expected);
  });
});

describe('embedded viz assets are non-empty inlinable constants (ship inside the SEA blob)', () => {
  it('each constant carries real content that will inline into the bundle', () => {
    expect(VIZ_TEMPLATE_HTML.length).toBeGreaterThan(0);
    expect(VIZ_VIEWER_CSS.length).toBeGreaterThan(0);
    expect(VIZ_VIEWER_JS.length).toBeGreaterThan(0);
    expect(VIZ_VENDOR_JS.length).toBeGreaterThan(0);
  });

  it('the vendored constant carries the ISC attribution + a d3-force marker', () => {
    expect(VIZ_VENDOR_JS).toContain('Copyright 2010-2021 Mike Bostock');
    expect(VIZ_VENDOR_JS).toContain('forceSimulation');
  });

  it('the template exposes the four inline markers handleViz fills (no external refs)', () => {
    expect(VIZ_TEMPLATE_HTML).toContain('/*__DBGRAPH_CSS__*/');
    expect(VIZ_TEMPLATE_HTML).toContain('/*__DBGRAPH_DATA__*/');
    expect(VIZ_TEMPLATE_HTML).toContain('/*__DBGRAPH_VENDOR__*/');
    expect(VIZ_TEMPLATE_HTML).toContain('/*__DBGRAPH_VIEWER__*/');
  });
});
