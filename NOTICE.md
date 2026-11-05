# Third-party notices

The plugin’s original code is licensed under MIT; see `LICENSE`.

This package contains or installs the following draw.io components. Their licenses apply to
those components. This list is an inventory, not legal advice.

## draw.io GraphViewer

- File: `server/assets/viewer-static.min.js.txt`, byte-identical to `js/viewer-static.min.js`
  in the official draw.io release `v32.6.10` web application archive `draw.war`
  (GitHub release of `jgraph/drawio`, tag commit `c72c9a98`).
- `draw.war` sha256 `a57b06b3b6a876a351dacfe65d027d9509319cd030e9bacf6ae04a034d66a38f`.
- Viewer sha256 `dfa1cfb4ef24320b67131405da88511e7baba48621ddd5260eea8ec5f6425928`,
  8,808,136 bytes. The daemon verifies this hash before serving the file.
- Licensed under the Apache License 2.0: `licenses/drawio-Apache-2.0.txt`, the `LICENSE` file of
  `jgraph/drawio` at tag v32.6.10.
- The viewer embeds draw.io stencil and icon libraries, which carry an additional restriction
  reproduced unchanged from the same archive in `licenses/drawio-stencils-NOTICE.txt`.

## draw.io Tool Server

- npm package `@drawio/mcp` 1.10.1 (source `jgraph/drawio-mcp`), installed as a dependency and
  locked in `npm-shrinkwrap.json` with integrity
  `sha512-dPNCVwHFITUFEylCQRfwrzC9gwiVq3F6zrE4Chw5/sBS0yumC24eT4n2njktsFUXmEfS82Xj4QGLz/1efRrTzg==`.
- Licensed under the Apache License 2.0: `licenses/Apache-2.0.txt`, the `LICENSE` file of
  `jgraph/drawio-mcp` (identical at the 1.10.1 version commit `2f8e65be`).
  The published package does not include its license file; the text shipped here is the
  license file of the `jgraph/drawio-mcp` repository.
- Its transitive dependencies keep their own licenses inside `node_modules`.

## pako

- npm package `pako` 2.2.0 (MIT AND Zlib), bundled into the app-side code to measure compressed
  pages before they are rendered. Locked in `npm-shrinkwrap.json`. License texts:
  `licenses/pako-MIT.txt` (the package's `LICENSE`) and `licenses/pako-Zlib.txt` (the zlib notice
  from the header of its `lib/zlib` sources).

## libxml2-wasm and libxml2

- npm package `libxml2-wasm` 0.7.2 (MIT, `jameslan/libxml2-wasm`), installed as a dependency and
  locked in `npm-shrinkwrap.json` with integrity
  `sha512-Ek8Fdb8fIl6mBCvrMGImkOP02aDpANwus0PV827v4gobV9jnoYEHNoPTwWokt71egUBl+sng53fjZ5y2PexLqQ==`.
  It contains a WebAssembly build of libxml2, inlined in `lib/libxml2raw.mjs`. Used only on the
  daemon, by `server/xml-source.mjs`, to expand the DTD of diagrams that declare one.
- License texts: `licenses/libxml2-wasm-MIT.txt` (the package) and `licenses/libxml2-MIT.txt`
  (libxml2, as shipped in the package's `LICENSE.libxml2`).

## draw.io ELK layout bundle (downloaded, not included)

- This package does not contain the bundle. `server/launcher/prepare-elk.mjs` (run by the managed
  install, or as `npm run prepare-elk`) downloads `src/main/webapp/js/elk/drawio-elk.min.js` from
  `jgraph/drawio` at tag v32.6.10 into the private per-user cache and keeps it only if it is
  923,334 bytes with sha256 `25847b1ded5d2fed2e175ec0d781d6e36b6d2971d29d3959c6aac70ddfedd394`
  (`@drawio/elk 0.1.0+commit.ce35b42`; byte-identical to `js/elk/drawio-elk.min.js` in the same
  release's `draw.war` and to the draw.io CDN copy checked on 2026-11-04). `prepare_drawio_xml`
  passes the verified file to the Tool Server through its documented `DRAWIO_ELK_URL`
  local-file option.
- Distributed within `jgraph/drawio` under the Apache License 2.0 (`licenses/drawio-Apache-2.0.txt`).
  It carries no license header of its own and contains code from the Eclipse Layout Kernel,
  licensed under the Eclipse Public License 2.0 (`licenses/EPL-2.0.md`, copied from the `elkjs`
  repository). No published source for this bundle was found: draw.io's Code Map lists the
  `js/elk/` bundles as built outside the `jgraph/drawio` repository, no source map is published
  with it, and no public `@drawio/elk` repository or package exists. The availability of its
  corresponding source is therefore not established here.

## draw.io shape search index

- File: `server/assets/shape-search-index.json`, byte-identical to `shape-search/search-index.json`
  in `jgraph/drawio-mcp` at the `@drawio/mcp` 1.10.1 version commit `2f8e65be8e28` (unchanged
  through `2a0f5703`). sha256 `a88a6af744636af362122d8e9b2518222cd0ac62a61592621cdbf2c4afbbe14d`,
  4,764,315 bytes. The Tool Server reads it through its documented `DRAWIO_SHAPE_INDEX_URL`
  local-file option instead of downloading it.
- Licensed under the Apache License 2.0 (`licenses/Apache-2.0.txt`). It describes draw.io stencil
  styles, so the stencil notice in `licenses/drawio-stencils-NOTICE.txt` also applies.
