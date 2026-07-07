# Vendored client-side viz assets — provenance (ADR-010)

These files are **VENDORED** static text, committed to the repo — `vendored, not npm-installed, no CDN`.
They are **NOT** `npm install`ed, are **NOT** listed in `package.json` dependencies, and are
**NEVER** fetched from a CDN. `dbgraph viz` inlines them into the emitted HTML at export time so
the output renders fully offline (`file://`, air-gapped). See
`docs/adr/010-vendored-client-viz-asset.md`.

## License — ISC (NOT MIT)

> HONESTY NOTE: the graph-viz design (Decision Q1) assumed these packages were **MIT**.
> The actual upstream license for every d3 module below is **ISC** (Copyright 2010-2021
> Mike Bostock). The vendored files preserve the original ISC `LICENSE` text verbatim in
> a leading block comment; the upstream `// https://d3js.org/…` attribution line is also
> retained. This record corrects the design's assumption to the verified fact.

## Packages

Obtained via `npm pack <pkg>@<version>` (no CDN) into a scratch directory OUTSIDE the
repo, extracted, and the upstream `dist/*.min.js` copied under an ISC header block.

| Vendored file      | Package      | Version | Upstream                                   |
|--------------------|--------------|---------|--------------------------------------------|
| `d3-dispatch.js`   | d3-dispatch  | 3.0.1   | https://github.com/d3/d3-dispatch          |
| `d3-quadtree.js`   | d3-quadtree  | 3.0.1   | https://github.com/d3/d3-quadtree          |
| `d3-timer.js`      | d3-timer     | 3.0.1   | https://github.com/d3/d3-timer             |
| `d3-force.js`      | d3-force     | 3.0.0   | https://github.com/d3/d3-force             |

`d3-force` requires `d3-quadtree`, `d3-dispatch`, and `d3-timer` at runtime (its UMD
build reads them off the global `d3` object), so all four are vendored. Load order in the
emitted HTML: `d3-dispatch` → `d3-quadtree` → `d3-timer` → `d3-force` (each attaches its
exports to `globalThis.d3`; `d3-force` consumes them).

## Checksums (sha256)

### npm tarballs (`npm pack` output)

```
3d1a0b5c003e0e9608ad57f6ca21a0c8368031fcbe5f5317fe4e50b3f797ea23  d3-dispatch-3.0.1.tgz
d4145e9cecca8a6077e1099de96375ec9923b0de0df4004bd98aafa17c2d557f  d3-quadtree-3.0.1.tgz
05cdf901e1876a7f24f4c365a879252752e22e3cc52b131ca616639f07e8ed05  d3-timer-3.0.1.tgz
deacfa7ecb466f88717fe1863347dd65e5a5422d9f8c893d771cb2a7f987fa15  d3-force-3.0.0.tgz
```

### upstream `dist/*.min.js` (the exact bytes copied under the ISC header)

```
94b3bbdb6b98dc1325a15762b051013e8253999b0e0436b27d1da17b952ba0af  d3-dispatch.min.js  (d3-dispatch 3.0.1)
57e2ad12824ed82893ba447523f2a2fb9beeb9222aafb2c778a9f5b313348b0e  d3-quadtree.min.js  (d3-quadtree 3.0.1)
911ceda305f014b6b53ca68d5c896a9a387da120cfd56a421a2c60cca2fc9b36  d3-timer.min.js     (d3-timer 3.0.1)
1e07b473241328795d5ea9ad479a7bbabd765012fa2ef95633c83b69868dff6b  d3-force.min.js     (d3-force 3.0.0)
```

To re-verify: `npm pack d3-force@3.0.0 d3-quadtree@3.0.1 d3-dispatch@3.0.1 d3-timer@3.0.1`,
then `sha256sum *.tgz` and compare the tarball digests above; extract and
`sha256sum package/dist/*.min.js` for the dist digests.
