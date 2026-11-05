# S1 runtime acceptance (test author)

## Current status (supersedes the interim and blocked sections below)

Latest source checked: `8f757053` by tests and local checks only (`docs/reports/s1-tests-partial.md`); the last
isolated Paseo runtime run below is `a939b272`. The delta (routing cache location, reply size bound, descriptions,
licenses) was not reinstalled into Paseo.

Final DTD and runtime verification on `a939b272` (tree `fff42968…`): `npm test` 130/130, exit 0
(`.validation/s1/test-run-a939.txt`). Packed tgz sha256 `f00bd7677e09d375ba5eb5d30e81113f3bc5654d27d876bd172488eb58c9c3f6`,
37 files byte-identical to the commit, production-only `npm ci --offline` exit 0, `libxml2-wasm` 0.7.2.
Fresh isolated Paseo 0.15.0 daemon (127.0.0.1:47813, relay off, auth on, new password stored only as a hash;
real providers disabled; synthetic ACP provider only); torn down afterwards (`.validation/s1/evidence/final-runtime-dtd/`).
- Auth: unauthenticated HTTP 401; CLI and SDK WebSocket without or with a wrong password rejected.
- Real plugin RPC `drawio.prepare-source` over the authenticated WebSocket with the public SDK
  (`DaemonClient.invokePluginRpc`, `tests/acceptance/rpc-prepare-source.mjs`, exit 0): nested internal DTD →
  canonical `<mxfile>` with no DOCTYPE/ENTITY, labels expanded (first call 49 ms including the WASM load);
  external entity → `external-entity` (1 ms); quadratic and exponential → `too-large` (37–39 ms); malformed →
  `invalid-xml`; plain source returned unchanged; input over 2,000,000 rejected by the RPC schema; 24
  concurrent calls → 18 processed, 6 `unavailable`, next call ok.
- Inline rows (real web UI, headless Chrome, DNS blocked): the DTD fence renders `FX-DTD ACME Platform API` and
  `AB` (numeric references); the frame HTML and the viewer's graph XML contain no DOCTYPE, ENTITY or entity
  references; the external-entity fence shows its notice with no frame; the plain fence renders. On reload,
  2 `drawio.prepare-source` requests are sent (both DOCTYPE sources), none for the plain fence; 1 viewer asset fetch.
- File panel: DTD file renders with the same checks; external, quadratic, exponential and malformed show
  their notices with no frame; plain, compressed two-page and stencil files still render.
- Stale result: with the RPC queue busy, the open DTD file was rewritten to a second DTD version and then to plain
  XML; the panel showed only the final plain version at 3 s and 7 s. Whether the second DTD request was still
  pending when the plain version arrived is not proven.
- Network log: no diagram-bearing or external diagram hosts; only Chrome's own services, all DNS-blocked. No
  secrets in daemon or plugin logs. Primary `~/.paseo/config.json` unchanged (`3b147bfa50b09e9b`).
- Not covered here: light theme in a real renderer, phone browser, remote client, a live OpenCode turn, the
  managed npm/Git install path, daemon-side network measurement of the parser (`XML_PARSE_NONET` and
  `NO_XXE` by source). The adapter's real stdio and routing results above were not repeated.

Historical (superseded by the `a939b272` verification above): source checked at that time was `ef4dc14d` (tests and local browser frame evidence only; see
`docs/reports/s1-tests-partial.md`). The expansion-gate bypasses listed below for `340862c3` are closed by
the frame-level bound at `ef4dc14d`.

- Last revision run in the isolated Paseo 0.15.0 runtime: `0c5ca8d3` (package tgz `b0f16afc…56a5`).
  Every runtime check run on it passed (sections below). Later revisions (`7ad9dfe`, `340862c3`) were
  verified by the test suite and local decoder evidence only, not reinstalled in Paseo. The runtime was
  torn down at 22:45Z (`.validation/s1/TEARDOWN.md`).
- This is **not** a full S1 acceptance. Not covered: phone browser, remote client, light theme in a
  real renderer, the managed npm/Git install path (directory install only), a live OpenCode turn (model
  unavailable in this country). The owner decision on the `open_drawio_*` tools is pending.
- The launcher line-buffer statement in the `0c5ca8d3` section was true then; the 10 MiB bound landed in
  `7ad9dfe` and is covered by `tests/unit/line-relay.test.ts`.
- Open defects at `340862c3`: five expansion-gate bypasses confirmed against the pinned viewer decoder
  (see `docs/reports/s1-tests-partial.md`).

## Historical: interim report

Status: **INTERIM, BLOCKED** by a release-blocking client defect. Rendering acceptance not started.
Stopped by manager instruction at 21:40Z; no diagnostic production copy was made or run.

Revision under test: `a1e7887e4300dd201562497335e19d2e781e2a4b` (clean). `npm test` on it: exit 0,
67/67 (`.validation/s1/test-run-a1e7.txt`). Packed with `npm pack --ignore-scripts`:
`paseo-plugin-drawio-0.1.0.tgz` sha256 `25b1bc11…a210c5`, 28 files. Extracted to
`.validation/s1/runtime/pkg/package`, `npm ci --omit=dev --ignore-scripts --offline` exit 0
(97 packages, no network), no `.spikes`.

## Isolated instance

Paseo 0.15.0, home `.validation/s1/runtime/home`, listen `127.0.0.1:47713`, relay disabled, web UI on,
`pluginsEnabled`. The password is random, stored only in `runtime/secret/password` (0600), never
printed; the config holds only its bcrypt hash (made with Paseo's `hashDaemonPassword`). The CLI
reaches the local home through Paseo's own `home/local-credential`; TCP clients need the password.
The primary `~/.paseo/config.json` sha256 prefix was `3b147bfa50b09e9b` before and after.

| Check | Result | Evidence |
|---|---|---|
| Unauthenticated `GET /api/status` | 401 | shell output in this turn |
| TCP CLI, no password | `Password required` | `evidence/auth-and-install.txt` |
| TCP CLI, wrong password | `Incorrect password` (daemon logs rejected HTTP and WS) | same |
| TCP CLI, right password | OK | same |
| `paseo plugin install <relocated dir>` | exit 0, `drawio` `running` | same |
| Secrets in daemon/plugin logs | no hash, no password; only auth status messages | `home/daemon.log`, `evidence/plugin-logs.txt` |
| Fixture files read-only | 16 hashes unchanged | `evidence/fixtures-sha256-before.txt` |

## Real providers (current daemon-side plugin, not mocked)

Locating the plugin root with `config.get` found the relocated package. Every provider received
`paseo-drawio`, and the launcher was started with the workspace as cwd
(`evidence/launcher-parents.txt`).

| Provider / model | Result |
|---|---|
| codex / gpt-6.1-sol | **PASS**: listed `get_drawio_reference, get_page, list_pages, search_shapes, set_page`; `list_pages fx/multipage-plain.drawio` → One, Two (`evidence/provider-logs-1.txt`) |
| claude / claude-opus-5-5 (default mode) | **PASS** after one permission approval for the read-only `mcp__paseo-drawio__list_pages`; same 5 tools; One, Two; also used built-in ToolSearch (`evidence/provider-logs-claude.txt`) |
| opencode / default `opencode/crouton-alpha-free` | **BARRIER**: injected and launcher running, but the turn failed `This model is not available in your country`. Model/config not changed; no substitution |

## Release-blocking defect

The client plugin fails to evaluate in the real web UI:
`[Plugins] Failed to evaluate srv_…/drawio Error: Invalid timeline renderer kind: drawio.text`
(`evidence/watch-reload2.json`). Paseo 0.15.0 web client validates kinds with `/^[a-z][a-z0-9-]*$/`
(`v()`/`E` in `web-ui/_expo/static/js/web/index-c26368bf….js`); `shared/contracts.ts` uses dotted kinds.
Because `contribute` throws, no client part works: drawio fences show as plain code blocks
(`evidence/agent-multi.png`), and opening `fx/plain.drawio` from a reply link shows raw XML with no
viewer frame (`evidence/prod-file-tab.png`). Typecheck, compile and the server smoke test cannot see it.

Regression test added: `tests/unit/host-contract.test.ts` (fails on `a1e7887e` with
`drawio.text`; exit 1, `.validation/s1/test-host-contract.txt`).

## Harness (committed, test-owned)

`tests/acceptance/fixture-acp.mjs` (synthetic ACP provider that streams `replies/<name>.md`),
`gen-fixtures.mjs` (16 `.drawio` fixtures and 7 reply scripts: plain, bare model, multipage, compressed
two-page, layers with hidden layer, stencils, embedded and external images, font, link, malformed,
not-drawio, empty, comment prolog, 1.2 MB large, 2.1 MB oversized; replies multi, nested, crlf,
errors, many(7), unclosed, extimg), `cdp.mjs` (CDP driver incl. per-frame isolated-world eval).
Browser: task-owned headless Chrome, profile `runtime/chrome/headless`, every hostname except
`127.0.0.1`/`localhost` resolves to NOTFOUND, NetLog at `evidence/netlog-headless.json`.
In the first Chrome run `localhost` was blocked too (harness error, WS could not connect); fixed.
The web UI stores the daemon password in the task profile's `localStorage` (Paseo behaviour).

## Kept alive for the fixed revision (task-owned)

| PID | Process |
|---|---|
| 89560 / 89562 | isolated daemon supervisor / worker (listens 127.0.0.1:47713) |
| 89564 | isolated terminal worker |
| 90658, 90882, 91207 | claude, codex app-server, opencode serve sessions started by the isolated daemon |
| 90693, 90917, 91234 | drawio launchers (with their Tool Server children) |
| 91415, 91555, 91710, 91876, 92039, 92218, 92386 | fixture ACP agents |
| 95399 (+95407, 95408) | headless Chrome, CDP 127.0.0.1:9555 |

Not task-owned, untouched: primary daemon 50650, user `drawio-mcp` processes 22032/56360.
Teardown: `paseo daemon stop --home …/runtime/home`, `kill 95399`, verify the PIDs and ports
above are gone, then remove `.validation/s1/runtime` on instruction.

## Next (after the fix)

Reinstall the exact committed package into this instance (`paseo plugin install`/reload), then run
the matrix: inline fences (multi, nested, CRLF, errors, many/frame budget, unclosed, history after
daemon restart), file panel for all fixtures with hashes, delete/refresh, viewer RPC once per session,
CSP and NetLog egress (external image, font, link), local shape index with network blocked, the
native export sample, and the coordinator's headed check.

## Continuation on the kind fix `057a2b35` (21:43Z to 21:57Z)

Source `057a2b35e924321f851d63ef75e22c2d5e81dec5` (tree `449b35d0…`). Repacked:
`paseo-plugin-drawio-0.1.0.tgz` sha256 `6fe34575ad90d16dd7e0b26be782c25da5ee5e0b3800442185182fcb8d836760`.
The package was extracted to `runtime/pkg-057a/package`, and `npm ci --omit=dev --offline` gave exit 0.
All 28 packed files are byte-identical to `git show 057a2b35:<path>`. The old `drawio` entry was
removed, then `paseo plugin install` exit 0, status `running` (`evidence/install-057a.txt`).
Test commits: `13cf5092` updates the fence test to the hyphen kinds (`npm test` 69/69, exit 0), then
`1865e7cd` adds the cross-message regression test (`npm test` 71 tests, 70 pass, 1 intended RED, exit 1).

### Client loads; inline rendering (fixture ACP, real web UI, headless Chrome)

| Reply | Result |
|---|---|
| multi (2 fences, backtick and `~~~~`, mxfile 2 pages) | 2 sandboxed frames (`allow-scripts`), labels rendered, page switcher `1 / 2`, link prose kept |
| nested (quote, list item, fence inside a `md` fence) | quote and list diagrams rendered; quoted `NOT-RENDERED` stays code |
| crlf | rendered |
| errors | malformed: in-frame "XML could not be parsed"; svg: "not draw.io XML" notice; empty: "diagram is empty" |
| unclosed (complete) | rendered as diagram, no error |
| many (7 fences) | 4 live frames, 3 "Diagram paused" with "Show diagram" (limit 4 respected) |
| extimg (external image, Google font) | labels rendered; `<image href="https://egress-probe.invalid/…">` kept in SVG but never requested |

### RELEASE BLOCKER 2: item ids collide across assistant messages

The `twomsgs` fixture is one turn with two assistant messages separated by a tool call. The daemon
timeline holds both messages (`evidence/twomsgs-daemon-log.txt`): "First message./End one.", [Other],
"Second message./End two.". The web UI shows the second message twice: prose "Second message./End two."
in both slots, and both frames show only `FX-MSG2 second`. The first message's prose and its diagram
are both lost (`evidence/agent-twomsgs.png`, `probe-twomsgs.txt`). Every message emits
`text-0`, `diagram-0`, `text-1`; the host does not scope transformer output ids by source.
`assistant_message` has an optional `messageId` the plugin could use (`@getpaseo/protocol` `agent-types.d.ts`).
Separately, the fixture ACP session could not take a second turn ("acp does not support ACP session
resume"), so collisions across separate turns were not run. They are expected to behave the same.
Regression test: `tests/unit/transformer.test.ts` runs the transformer registered by the real
`index.client.tsx` and fails with `ids shared across messages: text-0, diagram-0, text-1`. Stability
from streaming to completion and on refetch passes.

### File panel (all 16 fixtures, reply links, `evidence/filepanel-matrix.txt`, `file-*.png`)

All correct: plain, bare model, multipage (1/2), compressed two-page (1/2), layers (hidden layer
not drawn), stencils (Cisco, AWS lambda, BPMN drawn from embedded libraries), embedded image,
external image (not fetched), font, link, prolog comment, large 1.2 MB (rendered), oversized 2.1 MB
(notice "2051 KB, limit 1953 KB"), malformed (parse error), not-drawio (notice), empty (notice).
The header shows "read-only". Cosmetic: empty and non-draw.io files show "1 page".
Paseo shows its own "Open .drawio files with" chooser (draw.io or Source); the plugin is the default choice.
Fixture hashes are unchanged after the whole matrix.

### Egress and cache

The NetLog covers all Chrome processes, out-of-process frames included. Count of each host:
`egress-probe.invalid` 0, `fonts.googleapis.com` 0, `fonts.gstatic.com` 0, `diagrams.net` 0, `jsdelivr` 0.
The other non-loopback entries are Chrome's own background services (autofill, accounts, update),
all resolved to NOTFOUND by the task rules. Viewer RPC: on a page reload showing 1 frame, exactly
1 `viewer-asset` request was sent over the WebSocket (`evidence/watch-rpc.json`). Once per session with
several frames was not isolated.

### Not run in this continuation

File change and delete refresh, history after a daemon restart, a shape search on the shipped
index with the network blocked, the native export sample, the headed check, phone and remote.
Real providers were not rerun: the fix changed only kind strings and no injection code. Earlier
results stand: Codex PASS, Claude PASS, OpenCode blocked by its model being unavailable in this
country.

### Headed check option for the coordinator

Start a task-owned headed Chrome with its own new profile, for example
`.validation/s1/runtime/chrome/headed`, at `http://127.0.0.1:47713/`. Choose "Direct connection":
host `127.0.0.1`, port `47713`, password typed from `runtime/secret/password` without displaying it.
Don't copy the password into any primary browser profile. Paseo then stores it in that task profile's
`localStorage`; delete the profile on teardown.

## Continuation on `d9f19257` (21:59Z to 22:06Z)

Source `d9f192575be1edb9f51d178c6dda99c6dfcd0068` (tree `67fa78e9…`), unchanged during the run; `npm test`
71/71, exit 0 (`.validation/s1/test-run-d9f1.txt`). Repacked tgz sha256
`04f39af7fe8051fecbbaf86b612c88019aedf3ff72cffc7a05b0d05a6289be8a`, extracted to `runtime/pkg-d9f1/package`,
`npm ci --omit=dev --offline` exit 0. All 28 packed files are byte-identical to `git show d9f19257:<path>`.
`plugin remove` then `install`: both exit 0, status `running` (`evidence/install-d9f1.txt`).

| Criterion | Result | Evidence |
|---|---|---|
| Two assistant messages, one agent (new run) | **PASS**: "First message./End one." > tool call > "Second message./End two."; frames `FX-MSG1 first`, `FX-MSG2 second` | `probe-twomsgs-d9f1.txt`, `agent-twomsgs-d9f1.png` |
| Same, history created under `057a2b35` and loaded with the fix | **PASS** | `probe-twomsgs-old.txt` |
| Whether rows carry `messageId` (prefix path or host fallback) | **UNKNOWN**: not visible in `paseo logs` JSON or on-disk storage; both paths not separately proven | n/a |
| Viewer RPC once per session with 7 diagrams | **PASS**: 1 `viewer-asset` request in 77 WebSocket frames after reload | `watch-rpc-many.json` |
| Frame LRU and recovery | **PASS**: live 4,5,6,0; click "Show diagram" on row 3 → live 5,6,0,3 (row 4 evicted), 4 frames, 3 placeholders | `many-recovery.png` |
| File change, delete, restore (panel open) | **PASS**: v1 → edit v2 shown; delete → "This file was deleted. The tab updates if it is created again."; recreate v3 shown; no reload needed | `live-file.txt`, `live-deleted.png`, `live-restored.png` |
| Daemon restart (`paseo daemon restart`, worker 89562 → 19946), history | **PASS**: plugin `running`; twomsgs and multi render after reload; old provider sessions, launchers and fixture agents exited with no orphan Tool Server | `daemon-restart.txt`, `probe-restart-*.txt` |
| Shape search on the shipped index, network denied | **PASS**: `sandbox-exec` profile denies outbound (sanity fetch → EPERM); `search_shapes "aws lambda"` returned results in 204 ms; empty `XDG_CACHE_HOME` stayed empty | `shape-search-offline.json`, `tests/acceptance/shape-search-offline.mjs` |
| Native export sample (for the S3 decision only, not a native path) | **SAMPLE OK**: official `viewer.graph.getSvg(...)` on `plain.drawio` gives SVG with `<switch>` (1 foreignObject plus `<text>` fallbacks, 3 labels); rasterized via canvas ×2 to PNG, canvas not tainted, labels visible | `native-export-fo.svg/png` (`nofo` identical: `mxClient.NO_FO` had no effect after the first render) |
| Fixture hashes / primary config | unchanged / `3b147bfa50b09e9b` | `fixtures-sha256-before.txt` |
| File panel header for empty and non-draw.io files | fixed in source (no page count shown); not re-shown in the UI | source diff |

Real providers were not rerun: injection code did not change. Codex PASS, Claude PASS,
OpenCode BARRIER (model unavailable in this country).

### Remaining before S1 acceptance

- Headed desktop check: NOT COVERED by me (headless only). Auth-safe option above.
- Phone browser and remote client: NOT COVERED (no connected device or host available to this task; no emulation claimed).
- OpenCode real run: blocked by model availability; needs an owner-side model choice.
- `messageId`-absent fallback path: not separately proven at runtime.
- Viewer RPC across several page sessions or clients: only single sessions measured.
- Owner decision on the three `open_drawio_*` tools: pending, unrelated to this run.

### Instance (task-owned, still running)

Supervisor 89560, daemon worker 19946 (127.0.0.1:47713), terminal worker 19958, opencode serve 20212
(child of 19946), headless Chrome 95399 (CDP 127.0.0.1:9555, profile `runtime/chrome/headless`).
Teardown: `paseo daemon stop --home .validation/s1/runtime/home`, `kill 95399`, check that PIDs and
ports are gone, then remove `.validation/s1/runtime` on instruction.

## Headed handover (22:08Z)

The headless Chrome 95399 had CDP 9555 and profile `runtime/chrome/headless`; I verified both, then
stopped it with SIGTERM (it exited; port 9555 freed). Its NetLog was copied to
`evidence/netlog-headless-final.json`. The same profile was relaunched without `--headless`, with the
same flags (CDP 127.0.0.1:9555, DNS block except loopback, NetLog `evidence/netlog-headed.json`).
Browser PID 22845 (helpers 22852-22863, 22976). Reused the stored isolated login without reading or
copying it: the page connected, showing 2 frames and both messages (`evidence/headed-handover.png`).
I did not inspect the visible window myself; the coordinator checks it.
Stop: `kill -TERM 22845`.

## Regression on review corrections `0c5ca8d3` (22:32Z to 22:38Z)

Source `0c5ca8d3c27865d576e128d3a0b7b77aa17e93dd` (tree `53878b67…`), unchanged; `npm test` 83/83, exit 0
(`.validation/s1/test-run-0c5c.txt`). Repacked tgz sha256
`b0f16afcebc34f82ca2d5348eab96620dbeb6e721b2b2aa411360dec375456a5`, extracted to `runtime/pkg-0c5c/package`.
`npm ci --omit=dev --ignore-scripts --offline` exit 0; `pako` is 2.2.0. All 28 packed files are
byte-identical to `git show 0c5ca8d3:<path>`. `plugin remove`/`install` (directory source): both exit 0,
status `running`, no build step logged for a directory install. The managed npm/Git build path was not exercised.

| Check | Result | Evidence |
|---|---|---|
| `tests/acceptance/link-escape.mjs` with real mouse clicks (UserObject `_self`, HTML anchor) | **PASS**, exit 0 (was 1): both frames stay `about:srcdoc`; NetLog `egress-probe.invalid` count unchanged (13, all from the earlier RED run) | `evidence/link-escape-0c5c/result.json` |
| Dark theme reaches the viewer | **PASS**: `.geDarkMode` present, `.mxgraph` `color-scheme: dark`; shapes drawn dark-styled in the file panel | `file0c5c-*.png`, `probe-regress.txt` |
| Light theme in the runtime | **NOT RUN** (app theme not switched); unit test covers the light config | n/a |
| Tall inline diagram (40 cells, 2821 px) | **PASS**: frame capped at 720 px, body `overflow: auto`, scroll reaches 2101 px | `probe-regress.txt` |
| Shrink after zoom out | **PASS**: frame 720 → 404 px; 3 frames, 0 paused, no eviction churn | `regress-zoomed.png` |
| Quoted fence and `- - -` + two-space fence (column-0 content) in a real reply | **PASS**: both render (`FX-QSTREAM`, `FX-HRFENCE`); streamed transient states only unit-tested | `probe-regress.txt` |
| File panel: plain, compressed two-page, multipage, stencils, embedded image, malformed | **PASS**: headers correct; page toolbar Next → `2 / 2` shows page 2 (`FX-PAGE2 Gamma`, `FX-ZIP Two`); malformed shows parse error | `filepanel-0c5c.txt`, `file0c5c-*.png` |
| Compression bomb (111 KB file inflating to 21.5 MB) | **PASS** (refused): "This diagram is too large to show here (7813 KB, limit 7813 KB)". Cosmetic: it shows the limit as the size because expansion stops at the cap | `file0c5c-bomb.png` |
| Viewer asset once per session (3 diagrams) | **PASS**: 1 `viewer-asset` request after reload | `watch-0c5c.json` |
| Plugin or module evaluation errors in the console | none | `watch-0c5c.json` |
| Two-message fix persists | **PASS**: First and Second message, `FX-MSG1`/`FX-MSG2` | `probe-twomsgs-0c5c.txt` |
| `/drawio` while busy | Unit test passes: the handler throws "The agent is busy…" and does not send. Not run in the runtime (no busy agent). Limitation: the host clears the composer before calling the handler, so the typed request is lost on refusal; how the error is shown was not verified | unit test |

Review disposition, based on tests and evidence (not on the author's claims): F1, F2 (UserObject `_self`;
the anchor was already not navigating), F3, F4 (refusal), F5 (bound, scroll, shrink, touch on render
only), F7 and the F6 notification/batch and `close`-drain changes are verified. Not verified: F6 managed
Git build (directory install only), launcher exit drain under load. Still open: the F6 unbounded line
buffer was not changed. Real providers were not rerun (injection unchanged): Codex PASS, Claude PASS,
OpenCode blocked by model availability in this country. Headed task-browser view exists; phone browser and
remote client NOT COVERED.
