# Task cards: XML preparation adapter (owner decision 2026-11-05)

Owner decision: keep automatic repair and layout through a thin adapter over the official
`@drawio/mcp` 1.10.1 exported functions, returning XML without opening a browser. The official
engine stays unchanged. The three `open_drawio_*` tools stay blocked.

## Source facts (pinned `@drawio/mcp` 1.10.1)

- The `open_drawio_xml` handler (`src/index.js` about 946-1072) runs, in order:
  `repairDiagramXml(content)` then `leakedArguments(repaired.trailing, allowed)`
  (`src/repair-xml.js`); `normalizeDiagram(xml).xml` (`src/normalize-model.js`);
  `fitEdgeLabels(addLabelPerimeters(xml).xml).xml` (`src/label-perimeter.js`);
  `layoutXml(xml, { direction })` when `postLayout === "elk"` (`src/elk-pass.js`);
  `routeXml(xml)` when `routing === "libavoid"` (`src/libavoid-pass.js`); then builds the
  `app.diagrams.net` URL and spawns the browser. Repair and normalize failures are skipped with
  a log line; an ELK failure becomes a note; `routeXml` never throws.
- All five functions are module exports and can be imported without starting the MCP server
  or touching the browser code in `index.js`.
- ELK: `elk-engine.js` loads the bundle through `loadCachedSource(ELK_BUNDLE)`; `ELK_BUNDLE.url`
  honours `DRAWIO_ELK_URL`, and a non-URL value is read from disk without network or cache
  writes. `draw.war` v32.6.10 `js/elk/drawio-elk.min.js` (923,334 B, sha256
  `25847b1ded5d2fed2e175ec0d781d6e36b6d2971d29d3959c6aac70ddfedd394`) is byte-identical to the
  CDN file the package would download. Header: `@drawio/elk 0.1.0+commit.ce35b42`.
- libavoid: `routeXml` always calls `loadCachedSource(ROUTING_CORE)`, whose URL is a hard-coded
  `https://viewer.diagrams.net/...` with no override. Every process therefore makes a conditional
  GET to the CDN and evaluates the downloaded script, falling back to the vendored copy only on
  failure. No diagram content is sent, but it is a runtime code download that cannot be avoided
  without patching `fetch` or the module, which is not allowed.
- Mermaid and CSV conversion happen in the browser behind the `#create=` URL; the package has no
  Node conversion. The adapter does not offer them.

## Decision needed before routing (material tradeoff)

| Option | Effect |
|---|---|
| R1 Ship repair, normalize, labels and ELK; no `routing` option | Fully offline. Agents lose libavoid obstacle-avoiding routing only |
| R2 Also offer `routing: "libavoid"` through the official `routeXml` | One request per process to `viewer.diagrams.net` for the routing core (no diagram data) and evaluation of the downloaded script, vendored fallback when offline |
| R3 Re-create the routing pass from the vendored core | Not a thin adapter; not proposed |

Owner decision 2026-11-05: R2. `routing: "libavoid"` runs the official `routeXml` after ELK,
as upstream does; its routing-library download carries no diagram data and falls back to the
copy bundled with the Tool Server when offline. The worker sets `XDG_CACHE_HOME` to a
plugin-owned per-user cache directory (`~/Library/Caches/paseo-plugin-drawio` on macOS,
`$XDG_CACHE_HOME` or `~/.cache` plus `paseo-plugin-drawio` on Linux, `%LOCALAPPDATA%` on
Windows), created with mode 0700 and checked to be a directory owned by the daemon user; if it is
not, a fresh private temporary directory is used. It was first placed under the shared system
temporary directory, which another local user could pre-create.

## Contract: tool `prepare_drawio_xml`

Added by the launcher next to the five official tools; never forwarded to the Tool Server.

- Description: built from the official `open_drawio_xml` description in the Tool Server's own
  `tools/list` reply (keeps the XML reference), with its first sentence replaced by:
  "Repairs, normalizes and optionally lays out draw.io XML with the official draw.io engine and
  returns the resulting XML. It does not open anything and does not write files: save the result
  to a .drawio file or reply with it in a drawio fence."
  If the official description is missing, a fixed fallback without the reference is used.
- Input schema (subset of the official `open_drawio_xml` schema; `lightbox` and `dark` dropped):
  - `content` string, required, mxGraphModel or mxfile XML, at most 2,000,000 characters.
  - `postLayout` enum `["elk"]`, optional.
  - `direction` enum `["vertical", "horizontal"]`, optional, only with `postLayout`.
  - `routing`: optional, `["libavoid"]` (owner decision R2).
- Validation errors (`isError: true`, nothing run): `content` missing or not a string, over the
  limit, unknown property values, `direction` without `postLayout`. Messages name the field.
- Pipeline: the same order and fallbacks as the official handler, including `leakedArguments`
  (options the model wrote into the XML). Repair or normalize failure: keep going, add a note.
  ELK failure: return the XML before layout with a note that layout did not run.
- Result: `content: [{ type: "text", text: <xml> }, { type: "text", text: <notes> }]`; the
  notes block reports only events: a skipped or failed pass with its reason, options taken from
  text after the XML, and routing that changed nothing; it is omitted when there is none. Output over 8,000,000 characters is an error, not truncated XML.
- No workspace reads or writes; the agent decides whether to save or show it.

## Execution and bounds

- Runs in a `worker_threads` worker started by the launcher per call, so ELK's global `eval`,
  memory and CPU stay out of the relay. `resourceLimits.maxOldGenerationSizeMb` 512; wall-clock
  timeout 30 s, then `worker.terminate()` and an error result. One call at a time; up to 4
  queued, further calls get a "busy, retry" error. The worker imports the official modules from
  the Tool Server entry's directory (already passed to the launcher), so the pinned package is
  the only engine.
- Worker environment: `DRAWIO_ELK_URL` points to the ELK bundle (shipped at first; now the verified
  per-user cache copy, see "ELK bundle: downloaded and pinned"). Under R1 no other network
  path would be reachable; with R2 (chosen) routing downloads its library as described above.
- Launcher shutdown terminates any running worker before exiting.

## Assets (superseded: the ELK bundle is no longer shipped; see "ELK bundle: downloaded and pinned")

- Historical: `server/assets/drawio-elk.min.js`, byte-identical to the WAR copy, next to the shipped shape
  index. Only the launcher's worker reads it (through `DRAWIO_ELK_URL`); no plugin bundle imports
  it. sha256 and provenance go in `NOTICE.md`.
- License: the bundle is distributed in `jgraph/drawio` (Apache-2.0) at tag v32.6.10,
  `src/main/webapp/js/elk/drawio-elk.min.js` (same sha256). It has no license header of its own
  and contains code from the Eclipse Layout Kernel (EPL-2.0). Both texts ship in `licenses/`;
  no separately published source for `@drawio/elk` was found.

## Files

| File | Change |
|---|---|
| `server/launcher/prepare-xml.mjs` | Pure helpers: `PREPARE_TOOL_NAME`, `buildPrepareTool(officialTool)`, `validatePrepareArguments(args)`, `formatPrepareResult({ xml, notes })` |
| `server/launcher/prepare-worker.mjs` | Worker body: imports the official modules, runs the pipeline, posts `{ xml, notes }` or `{ error }` |
| `server/launcher/drawio-toolserver.mjs` | `tools/list`: append the prepare tool built from the official `open_drawio_xml` entry before that entry is filtered. `tools/call prepare_drawio_xml`: validate, queue, run the worker, reply. Shutdown terminates the worker |
| `server/assets/drawio-elk.min.js` | Pinned ELK bundle (historical; removed, now downloaded by `server/launcher/prepare-elk.mjs`) |
| `shared/prompt.ts` | Contract: use `prepare_drawio_xml` to repair or lay out XML before saving or fencing it |
| `OVERVIEW.md`, `NOTICE.md`, `licenses/` | Feature, data flow (local only), ELK provenance and license |

## Tests the test author can write first (RED)

- Unit (`prepare-xml.mjs`): schema shape and enums; validation errors per field; description
  built from an official tool and the fallback; result formatting with and without notes.
- Process (real launcher, real `@drawio/mcp` 1.10.1): `tools/list` has six tools including
  `prepare_drawio_xml` and none of the `open_*`; a messy XML (text around it, stray `&`, edge
  without geometry) comes back repaired and parseable; `postLayout: "elk"` changes vertex
  positions; `direction: "horizontal"` lays out left to right; `routing` is refused under R1
  (superseded: R2 chosen, routing is offered);
  the call never spawns `open`/`xdg-open` (PATH trap) and makes no network request (run with an
  empty `XDG_CACHE_HOME` under a network-denied sandbox); a 2,000,001-character input is refused;
  a call during a running call is queued and both answer; launcher exit leaves no worker or
  child process.

## Triage of the latest review (source-checked)

| Finding | Status | Proposed fix |
|---|---|---|
| c0040 prefilter adds uncompressed page characters to the inflated-byte budget | Confirmed (`shared/diagram.ts` markup branch; the frame skips such pages) | Count only inflated bytes of compressed pages, as the frame and the docs state |
| c0041 source bound uses the trimmed length | Confirmed | Compare and report `xml.length`; keep the empty check on the trimmed text |
| c0042 theme hex regex matches 3 digits first | Confirmed (`client/theme.ts` pattern order, no end anchor) | Six-digit alternative first, anchor the end |
| c0043 entity expansion during the frame's parse is not bounded by the plugin | Plausible, unmeasured. The parse runs in the sandboxed frame and the viewer parses the same document anyway | Measure first in a browser: billion-laughs and quadratic-blowup documents under 2,000,000 characters through the production frame; record time, memory and the parse result. Change code only if the browser's own limits do not stop them; a restriction on internal entities would then be an owner tradeoff |

## DTD sources (owner decision 2026-11-05: keep DTD support with bounded expansion)

- Parser: `libxml2-wasm` 0.7.2 (MIT), exact-pinned. Checked first: `fast-xml-parser` 5.12 drops
  nested entity values; `@rgrove/parse-xml` 5.1 and `sax` 1.6 do not expand DTD entities;
  `saxes` 6.0 is unmaintained. libxml2 expands nested internal entities, detects loops and has a
  built-in amplification limit.
- The package is an ES module with top-level await and inline WebAssembly, so it cannot be
  bundled by Paseo. `server/xml-source.mjs` (plain ESM) is imported at run time from the plugin
  directory by the server bundle (`server/xml-source-loader.ts`) and parses in a worker thread
  (`server/xml-source-worker.mjs`): two at a time, sixteen waiting, ten-second timeout.
- API: `prepareDiagramXml(xml)` resolves to `{ status: "ok", xml }` or
  `{ status: "error", code, message }` with `too-large`, `external-entity`, `invalid-xml`, or
  `unavailable` (parser busy, timed out or not loadable). RPC `drawio.prepare-source`
  (`shared/contracts.ts`): input `{ xml }` up to 2,000,000 characters, the same output.
- Sources without `<!DOCTYPE` are returned unchanged and never reach the RPC. Others: the raw
  limit first; an external identifier on the DOCTYPE or in the internal subset, or any parameter
  entity, is refused before parsing (libxml2 would otherwise ignore an external DTD silently and
  accept internal parameter entities); then libxml2 with `NOENT`, `NONET`, `NO_XXE`, `NOCDATA`;
  the root element is serialized without formatting, so the DTD is dropped, and checked against
  2,000,000 characters.
- Client: `DrawioViewer` (file tab and inline rows) sends DOCTYPE sources through the RPC and
  renders only the returned XML; pending, error and retry states; a result for an older source or
  an unmounted view is ignored. The file tab shows no page count for such sources.

## ELK bundle: downloaded and pinned (owner decision, supersedes "Assets" above)

- Not shipped. `server/launcher/elk-bundle.mjs`: `ELK_BUNDLE_SHA256`, `ELK_BUNDLE_URL` (the
  v32.6.10 release tag file on GitHub, so the pinned hash does not drift with CDN releases),
  `elkBundlePath(cacheHome)`, `verifiedElkBundle(cacheHome)` (private regular file, pinned size
  and hash, no network), `prepareElkBundle({ cacheHome, url, force })` (60-second timeout, body
  read up to the pinned size, verified in memory, then written to a 0600 temporary file and
  renamed into the 0700 cache; a failed or mismatching download keeps the verified copy).
- `server/launcher/user-cache.mjs` holds the per-user cache helpers shared with the launcher.
- Preparation: `server/launcher/prepare-elk.mjs` (`npm run prepare-elk`; `--force`, `--optional`).
  The managed build runs it with `--optional` after `npm ci`, so an offline install still
  completes without ELK.
- Launcher: no ELK startup prerequisite. Each prepare call checks the cache; with a verified
  bundle the worker gets it as `DRAWIO_ELK_URL`, otherwise ELK is skipped with a note and the
  launcher never downloads it.
