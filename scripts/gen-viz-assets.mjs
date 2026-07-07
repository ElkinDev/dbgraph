/**
 * gen-viz-assets — regenerates src/cli/commands/viz/assets/embedded.generated.ts from the
 * on-disk viz asset files (ADR-010).
 *
 * The asset files (template.html, viewer.css, viewer.js, vendored d3) are the reviewable
 * source of truth; this script embeds them as TS string constants so `handleViz` assembles
 * the HTML with ZERO runtime filesystem access — which is what makes the output ship inside
 * the npm `dist` bundle AND the SEA blob (esbuild inlines the constants) and render offline.
 *
 * A drift-guard test (test/cli/viz/assets-embedded.test.ts) asserts the generated constants
 * are byte-identical to these files, so the two never diverge. Run: `node scripts/gen-viz-assets.mjs`.
 * Also invoked implicitly by developers before `npm run bundle:sea` when an asset changes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(scriptDir, '..', 'src', 'cli', 'commands', 'viz', 'assets');
const vendorDir = join(assetsDir, 'vendor');

/** d3-force needs d3-quadtree/d3-dispatch/d3-timer on the global `d3` first (UMD). */
const VENDOR_ORDER = ['d3-dispatch.js', 'd3-quadtree.js', 'd3-timer.js', 'd3-force.js'];

const read = (p) => readFileSync(p, 'utf-8');

const template = read(join(assetsDir, 'template.html'));
const css = read(join(assetsDir, 'viewer.css'));
const viewer = read(join(assetsDir, 'viewer.js'));
const vendor = VENDOR_ORDER.map((f) => read(join(vendorDir, f))).join('\n');

const banner = `/**
 * GENERATED FILE — do NOT edit by hand. Regenerate with \`node scripts/gen-viz-assets.mjs\`.
 *
 * Embeds the viz client assets (template + viewer + vendored ISC d3, Copyright 2010-2021
 * Mike Bostock) as string constants so \`handleViz\` assembles the self-contained HTML with
 * NO runtime filesystem access — the constants are inlined into both the npm \`dist\` bundle
 * and the SEA blob (ADR-010), so the emitted file renders fully offline. The on-disk asset
 * files under ./ (and ./vendor/) are the reviewable source of truth; a drift-guard test
 * pins these constants byte-identical to them.
 */

/* eslint-disable */
`;

const body =
  `export const VIZ_TEMPLATE_HTML = ${JSON.stringify(template)};\n\n` +
  `export const VIZ_VIEWER_CSS = ${JSON.stringify(css)};\n\n` +
  `export const VIZ_VIEWER_JS = ${JSON.stringify(viewer)};\n\n` +
  `export const VIZ_VENDOR_JS = ${JSON.stringify(vendor)};\n`;

const outPath = join(assetsDir, 'embedded.generated.ts');
writeFileSync(outPath, banner + '\n' + body, 'utf-8');
console.log(`generated ${outPath} (template ${template.length}, css ${css.length}, viewer ${viewer.length}, vendor ${vendor.length} chars)`);
