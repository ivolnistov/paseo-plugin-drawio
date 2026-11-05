# S1 implementation report: draw.io viewer plugin

Author: S1 production writer. Date 2026-11-04. Scope: approved `DESIGN-v5-ru.md` S1 row,
broken down in `docs/plans/2026-11-04-drawio-s1.md`. No tests were authored (separate test
author). This report records the production work and its corrections, newest at the end.

Runtime acceptance is recorded separately in `docs/reports/s1-runtime-acceptance.md`: the test
author installed and exercised the plugin in an isolated Paseo instance. The production writer
installed nothing, and the plugin has not been installed into the primary Paseo daemon.

The "Checks run" and "Remaining validation risks" sections below describe the first checkpoint.

## Revision

- Local repository `/Users/k2so/WORK/paseo-plugin-drawio`, branch `main`, no remote.
- Production checkpoint: `012014af2f9acefe30d93818db15f18e2f529420`. This report is committed on top.
- Ignored and untracked by design: `.spikes/`, `.validation/`, root planning documents,
  `node_modules/`. Planning documents verified byte-identical to their pre-work sha256 values.

## Checks run

| Check | Command | Result |
|---|---|---|
| Reproducible install | `npm ci --ignore-scripts` (after `rm -rf node_modules`) | exit 0, 391 packages |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Real Paseo compile | `compilePlugin` from installed `@getpaseo/server` 0.15.0 `compiler-build.js` | exit 0; client bundle 20,987 B; server bundle 8,831,867 B with the viewer embedded; no `__dirname`/`import.meta` |
| Server bundle smoke | Paseo `evaluateBundle` with a fake context | viewer RPC returns 32.6.10 and passes the in-process sha256 check; `claude`/interactive injects `paseo-drawio`; `pi` and `history` purpose skipped; cleanup removes the hook |
| Launcher smoke | launcher piped to the real `@drawio/mcp` 1.10.1 | `initialize.instructions` added; `tools/list` returns 5 tools (`get_drawio_reference, list_pages, get_page, set_page, search_shapes`); `tools/call open_drawio_xml` refused with `isError` and never forwarded |
| Package | `npm pack --dry-run --ignore-scripts` | exit 0; 27 files, 4.1 MB packed, 9.1 MB unpacked; only plugin files, notices and shrinkwrap |
| DOM audit | `rg` per Paseo plugin guidance on `client/` | DOM use only in `client/web.ts` (other hits are TS generics and string text) |

The compile and smoke harnesses were ad hoc scripts under `/tmp`, not shipped or committed.

## Pins and hashes

| Item | Pin |
|---|---|
| Paseo SDK (dev) | `@getpaseo/plugin` 0.15.0; manifest `requirements.paseo` `>=0.15.0` |
| GraphViewer | `server/assets/viewer-static.min.js.txt` = `js/viewer-static.min.js` from `draw.war` v32.6.10; sha256 `dfa1cfb4ef24320b67131405da88511e7baba48621ddd5260eea8ec5f6425928`, 8,808,136 B |
| `draw.war` | sha256 `a57b06b3b6a876a351dacfe65d027d9509319cd030e9bacf6ae04a034d66a38f` (S0 download, re-verified) |
| Shape index | `server/assets/shape-search-index.json` = `shape-search/search-index.json` of `jgraph/drawio-mcp` at the 1.10.1 version commit `2f8e65be8e28` (unchanged through `2a0f5703`); sha256 `a88a6af7…be14d`, 4,764,315 B |
| Tool Server | `@drawio/mcp` 1.10.1, integrity `sha512-dPNCVwHF…zTg==` (same as S0), exact dependency, `npm-shrinkwrap.json` (97 production packages, all with `resolved` and `integrity`) |
| Licenses | `licenses/Apache-2.0.txt` sha256 `006e61a1…7232`; `licenses/drawio-stencils-NOTICE.txt` sha256 `f4098ff0…ebdac` |

Viewer build choice (closes R10): the WAR build is identical to the S0-verified CDN build up to
byte offset 4,934,656 (0-based; `cmp` reports byte 4,934,657). The figure 4,932,632 in the first
version of this report was a UTF-16 character index, not a byte offset. From there the WAR build
inserts the embedded stencil libraries before the CDN build's tail. With the frame's network closed,
stencil shapes still render. Cost: 8.8 MB instead of 4.9 MB per client session and per live
frame. Switching builds is one file and one constant.

## What was built

- **File panel** `drawio-viewer` for `.drawio`: `useFileText`, loading, read error, deleted file
  (`PluginFileDeletedError`), automatic re-render on disk change. Never writes.
- **Timeline**: transformer on `assistant_message` splits all `drawio` fences (CommonMark rules,
  backtick and tilde fences, CRLF, fences inside block quotes and list items including on the
  marker line and wide ordered items; fences nested in other code blocks stay text; a fence
  closes with its container). Prose renders
  through Paseo `Markdown` so links open file tabs. Unclosed fence while streaming shows a
  pending row; when complete it is rendered (CommonMark semantics). Item ids are stable across
  streaming and scoped per message (`<messageId>:text-N`, `<messageId>:diagram-N`; see
  "Correction after runtime checkpoint `9d3cd5d9`").
- **Viewer frame**: `<iframe sandbox="allow-scripts" srcdoc>` with a CSP meta allowing only
  inline script, inline style and `data:`/`blob:` images and fonts; no `allow-popups`, so links
  and lightbox cannot open. Toolbar `pages zoom layers`, single `GraphViewer` instance with its
  own page switcher. Theme colors and dark mode from `theme.colors.surface0`. Parse errors and
  viewer errors show in the row.
- **Asset cache and frame budget**: one RPC fetch per client session (`staleTime`/`gcTime`
  Infinity); at most 4 live frames, file panels pinned, timeline rows evicted least recently
  used into a "Show diagram" placeholder.
- **Native**: honest notice on iOS/Android.
- **Tool Server injection**: `agent.open.before`, `purpose: "interactive"`, providers
  `claude`, `codex`, `opencode`; key `paseo-drawio`; launcher sets cwd to the workspace.
- **`/drawio`**: agent-context slash command; `paseo.agents.ref(id).send(buildDrawioPrompt(args))`.
- **Agent contract**: `DRAWIO_AGENT_INSTRUCTIONS`, delivered as MCP `initialize.instructions` and
  appended to every `/drawio` prompt.

## Test seams

See the plan's "Test seams" list. Pure exports: `splitDrawioFences`, `toTimelineItems`,
`classifyDiagramXml`, `countPages`, `buildDrawioPrompt`, `DRAWIO_AGENT_INSTRUCTIONS`,
`shouldInjectToolServer`, `MCP_PROVIDERS`, `buildToolServerEntry`, `TOOL_SERVER_ENV`,
`createToolServerInjector` (inject `resolveFiles`, `log`, `execPath`; pass `loadEntries`),
`selectPluginRoot` (inject the package-name probe), `resolveToolServerFiles`,
`verifyViewerSource`, `sha256Hex`, `FrameBudget`, `buildFrameHtml`, `FRAME_CSP`, `isDarkTheme`.
The launcher exports `transformClientMessage`, `transformServerMessage`, `createLineRelay`,
`BLOCKED_TOOLS`, `main`; importing it does not start anything.
`server/viewer-asset.ts` imports a `.txt` file, which plain Node/Vitest cannot load without a
text loader; test `verifyViewerSource` with a string and read the file with `fs` instead.

## Decisions the coordinator should know (technical, inside approved scope)

Historical, as of the first checkpoint. Current state: items 2 and 3 are superseded by the
`prepare_drawio_xml` section below (ELK and libavoid are available through the adapter) and by
`docs/reports/s1-runtime-acceptance.md` (Codex and Claude passed with the injected Tool Server;
OpenCode was blocked because its default model is unavailable in this country, with no
substitution).

1. **Plugin directory discovery.** Paseo 0.15.0 bundles and `eval`s the server entry, so it has no
   `__dirname`/`import.meta.url`, and the plugin process is not told its directory. The Tool
   Server path is found by reading `plugins` from daemon config with the plugin's own
   `paseo.config.get()` and choosing the entry whose `package.json` name is
   `paseo-plugin-drawio` (install id `drawio` preferred). This call returns the whole daemon
   config to the plugin process; only `plugins` is used. If the lookup fails, injection is
   skipped with a log line, and agent opens are never failed.
2. **Blocked Tool Server tools.** `open_drawio_xml`, `open_drawio_csv` and `open_drawio_mermaid`
   launch a browser on the daemon host at `app.diagrams.net` with the diagram in the URL. That
   is diagram-bearing third-party egress without an explicit user action (D7). The launcher
   hides and refuses them; `DRAWIO_BASE_URL` points at a dead loopback port as a second guard.
   Consequence: ELK/libavoid layout options (only exposed on `open_drawio_xml`) are unavailable.
   This is a thin stdio relay around the unmodified official server, not a replacement server.
3. **Provider list** is source-derived (`supportsMcpServers: true` in 0.15.0 for these IDs),
   not yet confirmed by real launches. Custom provider IDs (profiles) are skipped.
4. **No external open action** in S1 (D7 local-open condition undecided).

## Remaining validation risks (for test and acceptance)

- Nothing ran inside a real Paseo client: frame boot, `createViewerForElement` callback, the
  `"dark-mode"` config, `ResizeObserver` height messages, and RN-web `View` ref being a DOM node
  are unverified in this build (the S0 prototype used `processElements`).
- CSP meta in `srcdoc` plus `'unsafe-eval'`: whether GraphViewer needs eval, and whether any
  viewer feature breaks under the closed network, needs the fixture matrix (embedded images,
  external images, fonts, layers, stencils, large files).
- 8.8 MB string over plugin RPC and per-frame `srcdoc`; memory with 4 live frames; desktop and
  phone browser.
- `paseo.config.get()` permission and shape inside a plugin session; managed npm/Git installs
  where `@drawio/mcp` is hoisted beside the package (handled by Node resolution, untested).
- `process.execPath` in an Electron-hosted daemon (`ELECTRON_RUN_AS_NODE=1` set, untested).
- Real provider matrix: whether each provider accepts the injected stdio server and surfaces
  `initialize.instructions` to the model.
- Shape search now reads the shipped index (see corrections); no download and no cache write
  were observed with an empty `XDG_CACHE_HOME`. This is not a network-level proof.
- Transformer output for very large fences: no documented size cap for transformer data was
  found; the 64 KiB cap applies to daemon-appended rows.
- Headed reliability (R1), remote client (R9) and host CSP dependency (R4) remain as in v5.
- Native export sample (one, for the S3 decision) not produced here.

## Ownership state

- Files written: everything in the checkpoint commit plus this report. Not touched: planning
  documents, `.spikes/`, `.validation/S1-STATUS.md`, installed plugins, primary daemon,
  global npm state and registry configuration.
- No daemon, browser, agent, KensAI run, install, push or publication was performed.
- Temporary files: `/tmp/paseo-docs-s1`, `/tmp/paseo-init-s1`, `/tmp/s1-compile` (scratch only).

## Corrections after the test checkpoint `b95fa034`

The test author's run was 67 tests, 62 pass, 5 fail. Only production code and my docs changed;
tests, helpers and the `test` script are untouched.

| Defect | Fix |
|---|---|
| Fence inside a block quote, fence on a list marker line, fence in a wide ordered list item | `shared/fences.ts` now tracks CommonMark containers per line: block quotes (`>` plus one optional space) and list items (content column from marker width and spaces, five or more spaces or an empty item use one column). Open containers are continued before fence rules apply; a fence ends when its container ends; new containers are only recognised outside fenced code, so a drawio fence quoted inside another code block stays text. Prose slices keep their original Markdown, including `>` prefixes |
| Valid document starting with an XML comment rejected | `classifyDiagramXml` skips the whole XML prolog (declaration, processing instructions, comments, doctype) before checking the root; page counting ignores comments |
| Missing workspace printed a Node stack trace | The launcher reports `cannot use workspace <path>: ENOENT` or `Tool Server entry not found: <path>` on one line and exits 1 |

Extra cases probed ad hoc (not committed): a drawio fence inside a quoted `md` fence stays text;
a list inside a quote; a quote ending a fence; nested quotes; a thematic break before a fence;
prose with links before and after a quoted fence is preserved; a six-space fence in a list item is
indented code.

Shape index (coordinator request): `@drawio/mcp` documents `DRAWIO_SHAPE_INDEX_URL` and reads a
non-URL value from disk without caching. The pinned official index is shipped and the launcher
sets that variable to the path beside it (`SHAPE_INDEX_PATH`), so `search_shapes` makes no
download. Package grows by 4.76 MB unpacked.

Narrower path API (coordinator request): none exists in 0.15.0. The plugin process receives
`pluginDirectory` and `settingsDirectory` in its internal init message
(`plugins/plugin-process.js`), but the context passed to `contribute` contains only `handle`,
`registerProvider`, `registerUsageSource`, `registerSettings`, `addHook`, `on` and `before`; the
directory is used only to read provider icons. `PaseoApi` has no plugin or projection query. So
`paseo.config.get()` stays. Its result includes `providers` entries with a loose schema, which can
carry provider settings from the config file; the plugin reads only `plugins` and keeps nothing
else.

Not changed, pending the owner's decision: the three `open_drawio_*` tools stay filtered; no
adapter, no PATH change, no preload.

## Correction after runtime checkpoint `0d7fe96e`

- Timeline renderer kinds are now `drawio-text`, `drawio-diagram`, `drawio-pending`. The Paseo
  0.15.0 web client checks client registration ids and kinds with `/^[a-z][a-z0-9-]*$/`, and also
  checks transformed item kinds with the same rule.
- Other client registrations already satisfy it: file panel `drawio-viewer`, transformer
  `drawio-fences`, slash command `drawio`, file extension `drawio` (no dot, as required). The RPC
  name `drawio.viewer-asset` follows the separate RPC rule (dots allowed) and is unchanged.
- Host detail for the test author: the web client keeps a transformed item's `id` as given
  (`n.id ?? sourceId/index`), so ids like `diagram-0` are not prefixed with the source message
  id there. Whether two replies that each contain a diagram collide downstream is unverified and
  should be checked at runtime.

## Correction after runtime checkpoint `9d3cd5d9` (ids across messages)

Traced in the installed Paseo 0.15.0 web client (`web-ui/_expo/static/js/web/index-c26368bf….js`):

- The render model calls each transformer with `{ item, phase, sourceId: row.id }`, where `item`
  is built from the stream row and includes `messageId` when the row has one.
- Output items are keyed `${pluginId}/${output.id ?? `${sourceId}/${index}`}`. An explicit id is
  used as given, which made `text-0`/`diagram-0` collide across messages.
- The client reducer merges streamed chunks into one row only while `messageId` matches, so a
  row's `messageId` is fixed for its life (streaming, completion, refetch).

Fix: `scopeTimelineItems(items, messageId)` in `shared/fences.ts`, applied by the registered
transformer. With a `messageId`, ids become `<messageId>:text-0`, `<messageId>:diagram-0`, and
so on: deterministic, stable while streaming, distinct per message. Without a `messageId`, the
ids are omitted so the host derives `${sourceId}/${index}` from its own row id. That path is
scoped per row, but is positional: in rare streaming states a slot can change from prose to the
pending placeholder. Content is not lost.

Also: the file tab header no longer shows a page count for empty or non-draw.io files.

Checks: `npx tsc --noEmit` exit 0; `npm test` exit 0, 71 tests, 71 pass; Paseo compiler exit 0
(client 22,781 B). No test files changed.

## Corrections after the independent review (tests `34dcd53e`)

Tests before: 83, 76 pass, 7 fail. After: 83, 83 pass. No test or harness file changed.

| Finding | Disposition | Change and evidence |
|---|---|---|
| F1 dark mode | Fixed | `"dark-mode"` is `"dark"` or `"light"`; the pinned viewer's `isDarkMode` compares with the string `"dark"` |
| F2 frame navigation | Fixed in source; runtime check is the tester's `tests/acceptance/link-escape.mjs` | Boot script replaces `Graph.prototype.openLink` with a no-op (the only viewer path that assigns `window.location.href`, for `linkTarget="_self"`), makes `window.open` return null, and cancels the default action of clicks and aux-clicks on anchors whose `href` does not start with `#`. Internal page links (`data:page/...`) go through `customLinkClicked`, which is untouched |
| F3 streaming and thematic breaks | Fixed | A trailing newline no longer produces an extra empty line; while streaming, a last line that has not yet received its container prefix cannot close a fence; `- - -`, `* * *`, `___` and spaced variants are thematic breaks, not list items |
| F4 busy `/drawio` | Fixed by refusal | Paseo 0.15.0 `ActiveTurnBehavior` is `interrupt` or `steer`, and the daemon's `steerOrReplaceActiveTurn` may replace the turn when steering is not possible. No mode guarantees the turn survives, so `/drawio` throws "The agent is busy…" without sending while `agent.status` is `running`. The host clears the composer before calling the command |
| F5 expansion bomb | Fixed in `classifyDiagramXml` | Each compressed page is base64-decoded and inflated with `pako` (2.2.0, the version already locked under `@drawio/mcp`, now a direct exact dependency) using `onData` to count output and abort past the remaining budget; the aggregate limit is `MAX_EXPANDED_BYTES` 8,000,000 of inflated page data. Undecodable pages are left to the viewer. Client bundle grows from 22.8 KB to 96 KB |
| F5 sizing | Fixed in source, not runtime-tested | Height is measured from `#root.scrollHeight` with a `ResizeObserver` on `#root` (the document height never fell below the frame's own height); inline frames scroll (`overflow:auto`) instead of clipping beyond the maximum height; only `rendered` events refresh the frame's place in the live-frame budget |
| F6 Git install | Fixed | `paseo-plugin.json` `build`: `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. Paseo runs `build` only for managed Git and npm installs (`plugins/index.js` install and update paths), never for directory installs, so a working checkout is not pruned. Verified on a packed copy: exit 0, `@drawio/mcp` and `pako` installed |
| F6 launcher | Hardened | A blocked `tools/call` sent as a notification is dropped; batches are handled per element; the launcher exits on the child's `close` (stdio drained) instead of `exit`. Line buffer size is still unbounded |
| F7 page count | Fixed | Comments and CDATA are removed before counting; `<diagram/>` without attributes counts |
| Duplicate error notice | Not changed | Cosmetic |

Checks: `npx tsc --noEmit` exit 0; `npm test` exit 0 (83/83); `npm ci --ignore-scripts` exit 0;
Paseo compiler exit 0 (client 96,075 B, server 8,831,372 B); `npm pack --dry-run
--ignore-scripts` exit 0, 28 files.

## Final robustness correction (tests `2bd5458d`)

- Launcher line relay: lines are counted in UTF-8 bytes; a line over 10 MiB (the MCP SDK stdio
  limit) is discarded up to its newline without being held in memory, one stderr line reports
  the dropped size and direction, and framing resumes with the next line. Real launcher check: an
  11 MiB line followed by `initialize` produced the drop notice and a normal `initialize` reply.
- Expanded-size notice no longer reports a measured size, since inflation stops at the limit; it
  says the compressed pages expand beyond the limit.
- `npm test` exit 0, 85/85; `npx tsc --noEmit` exit 0.

## Corrections after the KensAI review of the consolidated root

Tests before: 90, 86 pass, 4 fail (`09c77c28`). After: 90, 90 pass. No test file changed.

| Finding | Disposition | Change and evidence |
|---|---|---|
| c0002 closed child stdin | Fixed | The launcher listens for `error` on the Tool Server's stdin, reports it once on one stderr line, and drops later writes; shutdown still follows the child's `close` with the child's exit code |
| c0007 truncated final reply | Fixed | On the child's `close` the launcher writes an empty chunk to its own stdout and exits in that write's callback, after everything queued before it has flushed. A broken client stdout exits at once; a 10-second unref'd timer bounds a client that never reads. Signals are forwarded to the child and end through the same path |
| c0006 gate bypass by references and CDATA | Fixed at the cause | Page content is now read the way the viewer's XML parser yields it: pages are found by a tokenizer that skips comments and CDATA as units; a page with an element child is an uncompressed model; otherwise its text is assembled from CDATA content and from text with numeric (decimal and hex) and predefined entity references decoded, comments removed, and that text is base64-decoded and inflated under the budget. Other named references are left as written (no DTD expansion). Payloads that still cannot be decoded are not labelled too large; the viewer reports them. Probed beyond the tests: hex references, CDATA plus trailing text, a payload split by a comment (all refused), small compressed pages plain and in CDATA (accepted) |
| c0008 source limit unit | Fixed | The source notice and `OVERVIEW.md` state the limit in characters (2,000,000); the expanded limit is stated in bytes (8,000,000) |
| c0009 refused frame | Fixed | The viewer keeps `refused` (live-frame limit held by file tabs) apart from `evicted`; a refused row says to close a draw.io file tab and offers "Try again". Budget policy unchanged |
| c0015 busy refusal loses the request | Fixed | The refusal repeats the request (`/drawio …`, cut at 300 characters) because the host clears the composer before calling the command. Nothing is sent |
| c0011 report contradiction | Fixed | Opening of this report points to the runtime acceptance report and separates isolated installs from the primary daemon |
| c0013 plan build statement | Fixed | P1 card marks the no-`build` statement superseded |
| c0016 native inspection | Fixed (low risk) | `DrawioViewer` returns the native notice before any classification; the file panel classifies only on web |
| c0017 double classification | Fixed (low risk) | The file panel passes its classification to the viewer through an optional `check` property |
| c0014 `countPages` unused | Kept | Tests import it; it now shares the page tokenizer with `classifyDiagramXml`, so the two cannot drift |
| c0001, c0003, c0004 commit narrative | For the final consolidated message | Wording proposed to the coordinator; the root commit is not amended in this pass |
| c0005, c0010, c0012 | Test author's files | Not touched |
| c0018 | Disproved by the coordinator | `@tanstack/react-query` is host-provided to client bundles |
| c0019 | Not changed | The pinned MCP SDK rejects batches, so the path is unreachable |

## Expansion gate at the viewer's own parse (tests `17067db0`)

The viewer reads a page as `trim(mxUtils.getTextContent(page))` (`textContent`) from the
document parsed by `DOMParser` (`mxUtils.parseXml`); non-empty text is base64-decoded and
inflated, and only an empty text falls back to an element child. Matching that with regular
expressions cannot cover internal DTD entities.

- Authoritative gate in the frame: `EXPANSION_GATE_SCRIPT` (`client/web.ts`) runs on the same
  `DOMParser` document the frame already checks for parse errors, takes each `diagram` element's
  trimmed `textContent`, decodes it with `atob` and inflates it with the viewer's own `pako.Inflate`
  (raw), counting output and stopping past `MAX_EXPANDED_BYTES` (8,000,000). Over the limit, the
  frame shows the size notice and never creates the viewer. Text that `atob` or inflate rejects is
  skipped, as the viewer cannot decode it either. No dependency, parser or restriction added;
  internal DTD entities are expanded by the browser exactly as for the viewer.
- Headless Chrome with the pinned viewer and the 22 variants from
  `tests/acceptance/expansion-variants.mjs` (production frame document, local file, network
  blocked by the frame CSP): all 11 "big" variants, including the internal DTD entity, ended with
  the size notice; all 11 "small" variants, including the internal DTD entity, rendered.
- Shared prefilter (`classifyDiagramXml`): page text now follows the same rule (character data of
  the whole page subtree, CDATA and references resolved, comments and processing instructions
  skipped, quoted attribute values may contain `>`; text first, element child only when the text
  is empty). It does not expand DTD entities and says so; the frame gate covers that case.
- Tests: 95, 94 pass. The one failure is "refuses the page when its text comes from an internal
  DTD entity" in `tests/unit/expansion-gate.test.ts`, which asserts on the prefilter. The bound for
  that case is enforced in the frame; the assertion needs the test author's decision (target the
  frame gate in a browser, or accept the prefilter's result).
- The frame rejects documents with XML parse errors, while the viewer would first try
  `mxUtils.repairXml`; this conservative behaviour predates this change.

## XML preparation adapter and review fixes (tests `70185c97`)

Owner decisions 2026-11-05: keep automatic layout through a thin adapter over the official
functions; R2 (official libavoid routing with its library download) approved; DTD support to be
kept with a bounded XML parse (not implemented in this pass).

- `prepare_drawio_xml` (`server/launcher/prepare-xml.mjs`, `prepare-worker.mjs`, launcher): listed
  next to the five official tools; never forwarded. Runs the official `repairDiagramXml` and
  `leakedArguments`, `normalizeDiagram`, `addLabelPerimeters` and `fitEdgeLabels`, `layoutXml`
  (ELK) and `routeXml` (libavoid) from the pinned package directory, in the upstream order, in a
  fresh worker per call (30 s timeout, 512 MB heap, one at a time, four queued). Returns the XML
  and notes; writes nothing. The description keeps the official XML guidance and adds a note that
  the three `open_drawio_*` tools are not available, because the official text recommends
  `open_drawio_mermaid`.
- ELK ran from `server/assets/drawio-elk.min.js` (historical; now downloaded and verified, see
  "ELK bundle downloaded at preparation") through `DRAWIO_ELK_URL` (provenance and
  licenses in `NOTICE.md`). Routing downloads the official routing library into a plugin-owned
  cache under the system temporary directory, falling back to the bundled copy offline. (Since
  moved to a per-user cache directory; see "Last correction pass".)
- The launcher refuses to start when the shipped shape index or ELK bundle is missing, so neither
  is ever downloaded (c0061).
- c0040 only inflated bytes of compressed pages count against the expanded limit; c0041 the
  source limit applies to the untrimmed source; c0042 the theme colour reads six hex digits first
  and must match whole; c0046 the agent instructions name both limits and the adapter; c0050 the
  id form above is message-scoped; c0051 sizes are shown in characters; c0064 `OVERVIEW.md`
  states the one-time `npm ci --omit=dev --ignore-scripts` for directory installs.
- Real launcher smoke: six tools listed; ELK horizontal layout placed A, B, C left to right in
  about 0.2 s; `routing: "libavoid"` routed an edge around a blocking shape in about 0.3 s;
  an invalid routing value is refused naming the field.

Test status (not edited): 115 tests in total. All files except `tests/process/launcher.test.ts`:
106 tests, 105 pass. Remaining failures belong to test contracts:

- `final-review.test.ts` "accepts a document whose compressed pages fit…" fails its own
  precondition: the fixture inflates to 10,849,031 bytes, above the 8,000,000 limit it means to
  stay under. `classifyDiagramXml` is not reached.
- `launcher.test.ts` "exposes every upstream tool except the browser openers" expects exactly the
  five upstream tools; the adapter adds a sixth. The assertion fails before the test kills its
  launcher, so the file never finishes (the other eight tests in that file pass).

Not done: bounded XML parsing that keeps DTD support (owner decision received; contract to be
agreed and tests written first).

## DTD sources on the daemon (tests `5d4385b4`)

Implements the agreed option A; details and API in the plan's "DTD sources" section.

- Parser probes (before implementation, throwaway): libxml2 expanded single, nested and page-text
  entities and kept attribute and numeric-reference meaning; refused external SYSTEM and PUBLIC
  entities ("Attribute references external entity"), quadratic and exponential expansion
  ("Maximum entity amplification factor exceeded", about 3 ms), entity loops ("Detected an entity
  reference loop") and malformed XML. It accepted an external DTD identifier without loading it,
  and a valid internal parameter entity; both are now refused by an explicit scan of the DOCTYPE.
  `XML_PARSE_NOERROR` hides the detail messages, so it is not used.
- CDATA is merged into escaped text (`XML_PARSE_NOCDATA`); the text content the viewer reads is
  unchanged.
- WebAssembly memory is not bounded by worker heap limits; expansion is bounded by libxml2's
  amplification check and the 2,000,000-character source limit, and each parse by a timeout.
- Paseo compiler plus bundle evaluator: the server bundle loads `server/xml-source.mjs` at run time;
  `drawio.prepare-source` returned canonical XML for an internal entity and `external-entity` for
  an external DTD. libxml2 is in neither bundle (client 101,287 B, server 8,833,651 B).
- Tests: `npm test` exit 0, 130 tests, 130 pass, 2.2 s. No test files changed.
- Not done here: a browser run of the canonical XML through the production frame and an isolated
  Paseo run; both belong to the tester.
- API addition beyond the agreed test contract: error code `unavailable` (parser busy, timed out
  or not loadable). The tests do not exercise it.

## Last correction pass (tests `8a7cb8d5`)

- c0134: the routing cache is a per-user directory (`userCacheHome`: macOS
  `~/Library/Caches/paseo-plugin-drawio`; Linux `$XDG_CACHE_HOME` or `~/.cache` plus
  `paseo-plugin-drawio`; Windows `%LOCALAPPDATA%\paseo-plugin-drawio\Cache`), created with mode
  0700 and checked by `privateCacheDirectory` to be a non-symlink directory owned by the daemon
  user; otherwise a fresh private temporary directory is used. Download, evaluation and offline
  fallback are the official code's, unchanged.
- c0129: `encodePrepareReply` serializes the prepare reply and, when the line would exceed the
  10 MiB relay limit, sends a short error result for the same request id instead. The 8,000,000-
  character tool output limit is separate and unchanged.
- c0124, c0126, c0139: the tool schema publishes `maxLength` 2,000,000 for `content`; the
  description states the input and output limits and that Paseo renders only up to 2,000,000
  characters, so larger results should be split; `direction` says it requires `postLayout`.
- c0144: the agent instructions mention `prepare_drawio_xml` only for agents that have the
  draw.io tools and tell others to write the XML themselves.
- c0131, c0132: `licenses/pako-MIT.txt` and `licenses/pako-Zlib.txt` (from the pinned pako
  package); `licenses/drawio-Apache-2.0.txt` is the `jgraph/drawio` v32.6.10 `LICENSE`, which
  differs in wording from the `jgraph/drawio-mcp` one kept as `licenses/Apache-2.0.txt`. NOTICE
  points each component to its own file and no longer states copyright holders.
- c0125, c0147: plan notes describe actual note events; the earlier decisions section is marked
  historical with the current provider results.
- Not changed: c0127 (the worker's `stdout: true` is what keeps worker output off the protocol),
  c0133 (unreachable with the pinned package), and the cleanup and coverage items.

## Small delta after the full review of root `7700e54` (tests `a13ab958`)

- c0193: `findExternalReference` now reads the DOCTYPE one declaration at a time. `SYSTEM` and
  `PUBLIC` count only right after the declared name of the DOCTYPE, an `ENTITY` or a `NOTATION`;
  entities, elements and attributes named or valued `SYSTEM`/`PUBLIC` are accepted. Quoted
  literals, comments and processing instructions are still skipped, and any `%` outside literals
  is still refused. Parser options, limits and the canonical flow are unchanged.
- c0178, c0184, c0186, c0187, c0188, c0189: `content` publishes `minLength` 1 and says it must not
  be blank; the description and `OVERVIEW.md` say no workspace files are written (routing updates
  the plugin's library cache); output limits name both 8,000,000 characters and the 10 MiB UTF-8
  reply; larger diagrams go into separate files under 2,000,000 characters each; the
  instructions offer `list_pages`/`get_page` only with the draw.io tools and the file tool
  otherwise.
- c0180: `.gitattributes` marks `server/assets/**` and `licenses/**` `-text`. A scratch clone
  with `core.autocrlf=true` kept the viewer, ELK bundle, shape index and license hashes; the same
  clone of the base commit without the file changed the viewer hash (`08abc872…`).
- c0192: no published corresponding source was found for `drawio-elk.min.js` (no source map,
  no public `@drawio/elk` repository or package; draw.io's Code Map says the bundle is built
  outside `jgraph/drawio`). `NOTICE.md` states this; no source availability is claimed.
- Tests: 143, 143 pass. No test files changed.

## ELK bundle downloaded at preparation, not shipped (tests `2b3afaa6`)

Owner decision: stop redistributing the ELK bundle; download it at install or explicit
preparation into the private per-user cache, accept it only against the SHA-256 pinned in the
plugin, then use the verified local copy without network checks. Earlier sections that describe
a shipped `server/assets/drawio-elk.min.js` are historical.

- Implementation per the plan's "ELK bundle" section; `server/assets/drawio-elk.min.js` removed
  from the repository and package.
- Download source: `https://raw.githubusercontent.com/jgraph/drawio/v32.6.10/src/main/webapp/js/elk/drawio-elk.min.js`
  (release tag, immutable in practice), not the unversioned CDN path whose content changes with
  draw.io releases.
- Real download into a scratch HOME: 923,334 bytes, sha256 `25847b1d…d394`, file mode 0600,
  cache directories 0700; a second run reported "already verified" without downloading.
- Real launcher with outbound network denied (`sandbox-exec`) and that HOME: ELK vertical placed
  A, B, C at y 12, 82, 152; horizontal at x 12, 122, 232; no notes.
- Managed build on an unpacked package with an isolated HOME: `npm ci --omit=dev
  --ignore-scripts --no-audit --no-fund` exit 0, then `node server/launcher/prepare-elk.mjs
  --optional` exit 0 with the pinned hash.
- Tests: 156, 155 pass. The failure is `elk-bundle.test.ts` "module … exists": its assertion
  message `String(mod?.message ?? mod)` is evaluated even when the import succeeded, and
  converting an ES module namespace to a string throws. The other eight preparation tests pass.
- The source availability of the ELK bundle remains as recorded in `NOTICE.md`; nothing here
  claims legal approval.

## Prepare runner shutdown (tests `c323ffb0`)

`createPrepareRunner` now has an explicit closed state. Each started call gets its settle
function before the ELK cache check, so `close()` (idempotent, never throws) settles the running
call and every queued call with a shutdown error, terminates a worker that already exists, and
starts no further work; a start that resumes after the check sees the closed state and launches
nothing; calls made after `close()` are answered at once without a worker; an exception while
starting settles the call instead of leaving an unhandled rejection. Tests: 162, 162 pass.

## Narrow corrections after the corrective review (tests `29ef621b`)

- c0215: a failed `prepareElkBundle` re-reads the cache when it reports the failure, so `path`
  names the verified copy that exists then (stored by a concurrent preparation, or `null` if the
  copy was damaged meanwhile). The CLI still exits 1 on a failed download without `--optional`.
- c0213: `isPrivateFile` checks only the file type on Windows. libuv v1.52.1 (`src/win/fs.c`,
  lines 1956 to 1960), the version in the Node used here, reports every writable file as 0666
  copied into the group and other bits and a read-only file as 0444, so the group/other write
  test could never pass there. POSIX checks are unchanged. Not run on Windows.
- c0218: a call interrupted in a running worker reports that the request did not finish; calls
  that never started still say nothing was run.
- c0220, c0212, c0216: the skipped-ELK note is addressed to the user and says the other passes
  still ran; the `postLayout` description states the preparation condition; `OVERVIEW.md` no longer
  says the XML is returned unchanged.
- c0217: plan and report statements about the shipped ELK file are marked historical.
- c0210 (commit message wording) is left for the next corrective commit message.
