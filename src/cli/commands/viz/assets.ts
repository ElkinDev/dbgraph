/**
 * viz asset assembly — change graph-viz, Batch 3.
 *
 * Assembles ONE self-contained HTML string from the embedded client assets (template +
 * viewer + vendored ISC d3) and a deterministic embedded data block. The assets come from
 * `embedded.generated.ts` (string constants, ADR-010) so there is ZERO runtime filesystem
 * access — the output ships inside the npm `dist` bundle and the SEA blob and renders fully
 * offline (`file://`, air-gapped): no remote `<script src>`, no CDN, no fetch.
 *
 * ADR-004: pure string assembly; imports only sibling asset constants + core-free helpers.
 */

import {
  VIZ_TEMPLATE_HTML,
  VIZ_VIEWER_CSS,
  VIZ_VIEWER_JS,
  VIZ_VENDOR_JS,
} from './assets/embedded.generated.js';

/** Marker tokens in template.html replaced with the inlined payloads. */
const CSS_MARK = '/*__DBGRAPH_CSS__*/';
const DATA_MARK = '/*__DBGRAPH_DATA__*/';
const VENDOR_MARK = '/*__DBGRAPH_VENDOR__*/';
const VIEWER_MARK = '/*__DBGRAPH_VIEWER__*/';

/**
 * Replaces the first occurrence of `mark` with `value` using a FUNCTION replacer, so `$`
 * sequences in the asset/data text are never interpreted as replacement patterns.
 */
function inject(html: string, mark: string, value: string): string {
  return html.replace(mark, () => value);
}

/**
 * Assembles the self-contained viz HTML.
 *
 * @param dataJson - the serialized {@link import('../../index.js').VizGraphData} data block.
 *   Embedded verbatim inside `<script id="dbgraph-data" type="application/json">`. `<` is
 *   escaped to `<` so an embedded identifier can never break out of the script element
 *   (defensive; schema identifiers never contain `</script>` anyway) while remaining valid
 *   JSON that parses back byte-for-byte.
 */
export function assembleVizHtml(dataJson: string): string {
  const safeData = dataJson.replace(/</g, '\\u003c');
  let html = VIZ_TEMPLATE_HTML;
  html = inject(html, CSS_MARK, VIZ_VIEWER_CSS);
  html = inject(html, DATA_MARK, safeData);
  html = inject(html, VENDOR_MARK, VIZ_VENDOR_JS);
  html = inject(html, VIEWER_MARK, VIZ_VIEWER_JS);
  return html;
}
