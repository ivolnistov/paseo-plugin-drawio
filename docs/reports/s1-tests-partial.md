# S1 tests: report (test author)

## Current status (supersedes the historical sections below)

Final independent check on production `0598197c` (tree `1f5f5ebd`): `npm test` 168/168, exit 0, with the ignored ELK fixture
(`.validation/s1/test-run-0598.txt`); without it (moved aside, restored, sha verified) 168 tests, 156 pass, 12 skipped all
citing the missing pinned bytes, 0 fail, exit 0 (`.validation/s1/test-run-0598-nofixture.txt`).
- c0215 fixed: both concurrent-reporting tests pass (the failure result re-reads the verified cache).
- c0213: new `tests/unit/private-file.test.ts` with simulated stats (not a Windows run): win32 accepts a regular mode-0666
  file and rejects a symlink or directory; Unix still rejects group- or world-writable files, symlinks and a foreign
  owner, and accepts an own 0600/0644 file. Windows behaviour remains source-evidenced only.
- Wording read: closing with an active worker now says "the request did not finish"; the skipped-ELK note and the
  `postLayout` description match the behaviour. No new defects found.

Corrective-delta follow-up on `c37a4828` (tree `69b239ed`, base `7700e54c`; production unchanged): with the ignored ELK
fixture present, `npm test` 166 tests, 164 pass, 2 fail (RED), exit 1 (`.validation/s1/test-run-c37a.txt`).
- c0221 fixed (test defect): the two ELK layout tests now skip with a stated reason when the pinned bytes are absent; the
  concurrency test falls back to a fresh HOME (its ELK call then answers with a note). The pinned-hash/URL and default
  cache tests no longer need the bytes. Clean-checkout equivalent (fixture moved aside, then restored, sha verified):
  `npm test` 164 tests, 152 pass, 12 skipped with the reason, 0 fail, exit 0 (`.validation/s1/test-run-c37a-nofixture.txt`).
  No tracked ELK bytes and no download during `npm test`.
- RED c0215 (production): a preparation whose own download fails reports the cache as it was when it started. With a
  local server holding the failing request until a second, good preparation has stored the verified bundle, the failure
  still reports `path: null`; and when a verified copy is invalidated during a failing forced download, the failure still
  reports the old path. Both are event-driven (request arrival, explicit release), no sleeps. The strict CLI exit 1 on a
  failed forced download is unchanged and not challenged.
- c0213 (source evidence only, no Windows host): libuv synthesizes `st_mode` on Windows from the read-only attribute
  (0o666 writable, 0o444 read-only), so `isPrivateFile`'s group/other-write check would reject the freshly written bundle
  there and ELK would never be ready, while `ensurePrivateDirectory` already exempts win32. Not runtime-proven; no test,
  because `isPrivateFile` reads `process.platform` itself. Unix checks unchanged.
- Deferred (advisory coverage): c0211, c0214, c0219, c0222, c0223.

Shutdown fix GREEN on production `a75230ce` (tree `9c11c1da…`): `npm test` 164/164, exit 0
(`.validation/s1/test-run-a752.txt`). The three RED cases pass unchanged. Added: closing while a worker is running settles
the call with an error, a second `close()` resolves, no other worker starts, and the test process exits (the slow fixture
worker would otherwise keep it alive); a worker that cannot start settles its call with an error instead of hanging.
Minor wording: the shutdown error says "nothing was run" also for a call whose worker had already started.

Shutdown race RED on `dba05431` (production `f9ca3037` unchanged): `npm test` 162 tests, 159 pass, 3 fail (RED), exit 1
(`.validation/s1/test-run-dba0-shutdown.txt`). All 158 earlier cases still pass.
`tests/process/prepare-runner-shutdown.test.ts` drives the real `createPrepareRunner` with a fixture worker
(`tests/fixtures/toolserver/marker-worker.mjs`) that leaves a marker file in its scratch `sourceDir`, so every worker
start is visible; waits are bounded (5 s to settle, 1.5 s quiet period) and the `after` hook closes every runner.
- Control passes: one call, one worker, a result.
- RED: `close()` right after an accepted call rejects with `TypeError: Cannot read properties of null (reading
  'terminate')` (the placeholder `running.worker` is null while `start()` awaits the ELK cache check).
- RED: queued calls never settle after `close()` (the queue is emptied without resolving them).
- RED: a call made after `close()` starts a worker (nothing stops new work).
- Expected after the fix: close resolves, accepted and queued calls settle, no worker starts after close.

ELK preparation GREEN on production `f9ca3037` (tree `129b9430…`): `npm test` 158/158, exit 0
(`.validation/s1/test-run-f9ca-final.txt`). Not a Paseo-managed installation test; no Paseo instance was used.
- Test defect fixed (author's report confirmed): my module-existence assertion built its message with
  `String(namespace)`, which throws for an ES module namespace. Only the message expression changed.
- Added: a symlinked or group-writable cache file is not trusted even with the right bytes; four concurrent
  preparations end with one verified file and no temporary files.
- Real official download (scratch HOME, `node server/launcher/prepare-elk.mjs`): exit 0, 923,334 B, sha256 pinned, file
  `-rw-------`, cache and `elk` directories `drwx------`. Warm run with network denied: exit 0 "already verified".
  Forced refresh with network denied: strict exit 1, `--optional` exit 0, verified copy unchanged. Corrupted cached file
  with network denied: not trusted (strict exit 1, `--optional` exit 0); repaired online (exit 0, pinned hash).
  Evidence: `.validation/s1/elk-prepare-cli.txt`.
- Real launcher, network denied: prepared HOME lays out ELK vertically (y 12/82/152) and horizontally (x 12/122/232);
  fresh HOME returns the XML with the note "ELK layout did not run: the ELK bundle is not prepared … run npm run
  prepare-elk" and writes nothing (`.validation/s1/elk-offline-launcher.txt`).
- Package: tgz sha256 `2fe74409…aabd`, 42 files; `elk-bundle.mjs`, `user-cache.mjs`, `prepare-elk.mjs` packed; no packed
  file has the ELK hash. Managed build argv run on the unpacked package with an isolated HOME (npm cache reused):
  `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` exit 0, `node server/launcher/prepare-elk.mjs --optional`
  exit 0 (downloaded and verified, 0600); then `npm run prepare-elk` with network denied exit 0 "already verified".
  This is the command sequence only; how Paseo runs the build for managed installs is untested.
- Notes (same user only): runtime verification checks the file (not a symlink, size, hash, not group/world-writable)
  but not that the `elk` directory itself is not a symlink, and there is a check-then-use gap before the worker loads
  the file; both need write access to the user's own 0700 cache. libavoid behaviour unchanged.

ELK preparation RED on `0cf29c27` (production `b272c577`, unchanged): `npm test` 156 tests, 143 pass, 3 fail (RED),
10 skipped, exit 1 (`.validation/s1/test-run-0cf2-elk.txt`). All 143 earlier cases still pass. Owner decision: the ELK
bundle is no longer shipped; it is downloaded at install or explicit preparation into the private per-user cache,
accepted only when it matches the pinned SHA-256 (`25847b1d…d394`, 923,334 B), and then used locally with no further
network checks; a changed or broken download never replaces a verified copy.
- RED (expected until implemented): `server/launcher/elk-bundle.mjs` missing (1 fail, 8 gated cases skipped); the ELK
  bundle is still tracked and packed; the managed build has no preparation step after `npm ci`.
- Gated behaviour (`tests/unit/elk-bundle.test.ts`, real files, real HTTP from a local server, real SHA-256): fresh
  prepare downloads once, stores the pinned bytes inside the given cache with a 0700 directory and a non-writable-by-
  others file; a warm cache makes no request; a tampered download is refused (`hash-mismatch`) and stores nothing; a
  forced refresh that is tampered, truncated or fails keeps the verified copy and reports it; a corrupted cached file is
  not trusted and is replaced only by verified bytes; an interrupted download (`download-failed`) leaves no partial file;
  the default location is inside the launcher's private cache.
- Launcher (`tests/process/prepare-adapter.test.ts`): ELK tests now prepare a verified copy in their scratch HOME first
  when the module exists, so ELK vertical and horizontal layout stay checked offline (network-denied sandbox) after the
  shipped file is removed; the cache must not change during offline layout. Gated: the launcher starts and lists all
  tools without a prepared bundle, and an ELK request then returns XML with a note instead of failing, without
  downloading by itself. Before the module exists these tests use the shipped file and pass.
- Distribution (`tests/unit/elk-distribution.test.ts`): no packed `.js/.mjs/.txt` file may hash to the ELK bundle; the
  managed build must run a step after `npm ci` that executes a shipped `server/**.m?js` file or a package script, so a
  directory install can run the same command explicitly. The Paseo lifecycle for directory installs is not guessed.
- Proposed API (names are a proposal; the tests use them): `server/launcher/elk-bundle.mjs` exporting
  `ELK_BUNDLE_SHA256`, `ELK_BUNDLE_URL` (https), `elkBundlePath(cacheHome = PREPARE_CACHE_HOME)`,
  `verifiedElkBundle(cacheHome?) → Promise<path | null>` (hash check, no network), and
  `prepareElkBundle({ cacheHome?, url?, force? }) → Promise<{ status: "ok", path, downloaded } |
  { status: "error", code: "download-failed" | "hash-mismatch", message, path: retained verified path | null }>`.
- Fixture: the pinned bytes are kept only in the ignored `.validation/s1/fixtures/drawio-elk.min.js` (sha256 verified);
  tests also accept `S1_ELK_FIXTURE`. Without the bytes, the gated tests skip with a reason.

Small-delta verification on `b272c577` (tree `6af4e197…`; root `7700e54c` kept): `npm test` 143/143, exit 0
(`.validation/s1/test-run-b272.txt`), tests unchanged by the author. Not a new full S1 acceptance; no Paseo instance.
- c0193 fixed: all 8 legitimate SYSTEM/PUBLIC cases are accepted and the real external identifiers stay refused (unit
  tests). Extra probes through `prepareDiagramXml`: external identifiers separated by newlines or tabs, after a comment
  or PI containing the keywords, after a quoted `]>`, on a DOCTYPE without a space before `[`, NOTATION and NDATA, and a
  parameter entity in an ATTLIST are refused; keywords inside comments pass. A literal `%` in an entity value is refused,
  which is correct XML (it starts a parameter-entity reference).
- Browser: the canonical output of all 8 legitimate cases (labels expanded, no DTD left) renders in the production
  frame with the pinned viewer (temporary local Chrome, exit 0; `.validation/s1/c0193-browser/`).
- c0180 `.gitattributes`: assets and licenses are `-text`. A clone with `core.autocrlf=true` keeps all 11 files
  byte-identical (a control source file gets CRLF on 214 lines). Negative control at `a13ab958` (no attributes):
  `licenses/Apache-2.0.txt` gets CRLF on 191 lines and the viewer asset no longer matches its pinned sha256.
- Wording (source only): `content` `minLength: 1` and whitespace-only refusal; reply limit 10 MiB of UTF-8; writes only
  in the plugin's routing cache; file-tool fallback when draw.io tools are absent; split oversized diagrams into
  separate files.
- Open: ELK bundle source availability (c0192) and the owner's choice between a first-use CDN download with cache and
  waiting for a verified source. Not decided or tested here.

RED phase on root `7700e54c` (production unchanged; not an acceptance): `npm test` 143 tests, 142 pass, 1 fail
(intended RED), exit 1 (`.validation/s1/test-run-7700.txt`). All 139 earlier cases still pass.
- RED c0193 (`tests/unit/xml-source.test.ts`, through the async `prepareDiagramXml`): the DTD pre-scan refuses legitimate
  internal declarations as `external-entity`: `<!ENTITY SYSTEM "…">`, `<!ENTITY PUBLIC "…">`, a nested entity that
  refers to `&SYSTEM;`, `<!ELEMENT SYSTEM ANY>`, and a DOCTYPE named `SYSTEM` or `PUBLIC` (6 of 8 cases). The words inside
  quoted entity values or an ATTLIST default already pass. Real external identifiers after a declared name
  (`<!ENTITY SYSTEM SYSTEM "…">`, `PUBLIC "…" "…"` on an entity or the DOCTYPE) are still refused, as required.
- Fixed my tests, all passing on current production: c0183 asserts `PREPARE_CACHE_HOME` equals
  `userCacheHome(process.env, process.platform, homedir())` and checks an absolute Linux `XDG_CACHE_HOME` outside HOME with
  simulated inputs (not a Linux run); c0179 adds a 3.5 M-character CJK line (10.5 MiB) bounded by `Buffer.byteLength`
  with framing recovery; c0181 accepts only a refusal with nothing sent; c0182 requires a pending row at every prefix
  with a complete opener (quote and list); c0190 gives every adapter launcher its own scratch HOME, checks the cache
  `userCacheHome` actually uses, shows ELK offline writes no routing cache, and proves routing with network denied from
  a fresh HOME uses the bundled library (nothing downloaded). The real user routing cache was not modified.
- Not changed, pending the author's wording: c0178, c0184, c0186, c0187, c0188 (source/docs), c0192 (license source),
  c0185 (provider list).

Narrow verification on `8f757053` (tree `299e3482…`; changes since `8a7cb8d5`: routing cache location, reply size
bound, tool description text, licenses and docs). `npm test` 139/139, exit 0 (`.validation/s1/test-run-8f75.txt`),
including the c0134 test that was RED. The last isolated Paseo runtime run is still `a939b272`; this delta was not
reinstalled into Paseo.
- Routing cache: `userCacheHome` gives `~/Library/Caches/paseo-plugin-drawio` on macOS, `$XDG_CACHE_HOME` (absolute
  only) or `~/.cache` on Linux, `%LOCALAPPDATA%` on Windows, never the temporary directory.
  `privateCacheDirectory` (tested in a scratch directory): creates with mode 0700, tightens an own 0755 directory to
  0700, refuses a symlink (target left at 0755) and a file, falling back to a fresh 0700 `mkdtemp` directory; test
  fallbacks are removed. Real cache after the suite: `drwx------`, holding `drawio-mcp/libavoid-routing.json`
  (57,616 B) from the approved R2 download. Routing online and with network denied still pass.
  The old `<tmp>/paseo-plugin-drawio-cache` from earlier test runs was removed. Fallback directories are not cleaned
  up by the plugin (one per launcher process when the cache cannot be made private).
- Reply bound: `encodePrepareReply` counts UTF-8 bytes including JSON escaping (CJK and `"` cases), returns an
  under-limit reply unchanged, and replaces an over-limit reply (3.7 M CJK characters, about 11 MB) with a
  parseable error for the same id, under 1 KB, with no XML. Negative control: with the previous plain encoder the two
  bound tests fail and the unchanged-reply test passes. An id too large to fit in the limit is not covered.
- Worker `stdout: true` is unchanged (captures worker output; see c0127 above).
- Source check only: `content` schema `maxLength` 2,000,000; `direction` description states it needs
  `postLayout "elk"`; the tool description states the input and output limits.
- Licenses: `pako-MIT.txt` and `libxml2-wasm-MIT.txt` are byte-identical to the installed packages' `LICENSE`,
  `libxml2-MIT.txt` to `libxml2-wasm/LICENSE.libxml2`; all 15 lines of `pako-Zlib.txt` appear in pako's
  `lib/zlib/inflate.js` header. `drawio-Apache-2.0.txt`, `Apache-2.0.txt` and `EPL-2.0.md` come from upstream
  repositories and were not verified offline. No legal assessment.

Review follow-up on `585ccad1` (production unchanged): `npm test` 131 tests, 130 pass, 1 fail (intended RED), exit 1
(`.validation/s1/test-run-585c.txt`). All 130 earlier cases still pass.
- RED c0134: the routing cache `PREPARE_CACHE_HOME` is a fixed name directly under the system temporary directory
  (`tests/unit/cache-home.test.ts`). On macOS that directory is per-user; on a shared `/tmp` (Linux) another user
  could create it first, and the cached routing library is evaluated later. Source proof; no multi-user simulation.
- Disproved c0127 by a real worker probe: with `stdout: true` (production) worker stdout is captured and nothing
  reaches the parent's stdout; with the default or with `stderr: true` worker stdout goes to the parent's stdout,
  which is the JSON-RPC stream. The suggested change would introduce the problem.
- c0129 boundary, not reachable: the prepare reply skips the relay's 10 MiB line check, but with the official
  passes and the 2,000,000-character input limit the largest measured reply was about 6.3 MiB (bare edges: output
  3x input chars; CJK ids: 3.22 bytes per input char), and inputs near the limit approach the 30 s worker timeout.
  Hardening (check the reply size before writing) is reasonable; no RED test without a reachable case.
- c0133 not reachable with the pinned package: `routeXml` catches everything and returns the input XML; its module
  imports only shipped files and loads the WASM lazily inside the guarded call. Optional robustness only.
- Fixed c0130: `tests/acceptance/link-escape.mjs` now fails unless the label is found, the viewer rendered and the
  click was sent. Production run exit 0 (label, SVG, 3 mouse events in both cases); negative controls
  `S1_LINK_CONTROL=missing-label` and `not-rendered` exit 1 (`.validation/s1/c0130/`). Temporary Chrome only.
- Fixed c0138: every process spawned through `tests/support/mcp-process.ts` is registered and force-killed in
  `after` (`killAllSpawned`); a throwaway test that fails with a live launcher left no launcher or Tool Server.
- Fixed c0137: the generator adds `small-malformed` and `big-malformed`; the frame runner expects the parse-error
  notice for them (both shown, no viewer, exit 0).
- Fixed c0145: the older `ef4dc14d` sentence in the runtime report is marked historical.

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

DTD contract retargeted on `d764fece` (production unchanged): the RED tests now target the agreed daemon-side
module `server/xml-source.mjs`, `async prepareDiagramXml(xml)` resolving to `{ status: "ok", xml }` or
`{ status: "error", code: "too-large" | "external-entity" | "invalid-xml", message }`. `npm test`: 130 tests,
117 pass, 1 fail (module missing, import-level RED), 12 skipped, exit 1
(`.validation/s1/test-run-d764-dtd-async.txt`). Added case: canonical output without DOCTYPE/ENTITY, no
unresolved references, well-formed, `<mxfile>` root, at most 2,000,000 characters. The tests accept that the
parser's own amplification guard may refuse documents below that cap; legitimate cases stay far below both.
Adversarial cases are awaited in a time- and heap-limited worker. Checked against a throwaway stub in a
scratch copy: identity, raw bound and malformed pass; DTD cases fail on the stub; a never-settling cycle is
cut at 10 s. Not locked yet (no public contract): the client RPC name/schema and the browser regression that
both the file panel and inline rows render from the prepared source; to be added once the author defines
the RPC.


Adapter verification and DTD RED on `f157b4f3` (tree `24b18b46…`): `npm test` 129 tests, 117 pass,
1 fail (intended import-level RED), 11 skipped, exit 1, 2.1 s (`.validation/s1/test-run-f157-dtd.txt`).
- Adapter GREEN (owner decision R2): 18 adapter tests pass: 6 tools (5 official + `prepare_drawio_xml`), schema
  enums copied from the official `open_drawio_xml` including `routing`; repair/normalize/labels; ELK
  vertical/horizontal; invalid `routing`/`direction`/`content` refused; concurrent calls and clean exit;
  ELK and libavoid routing (waypoints, `libavoidRouting=1`) under a network-denied sandbox; no workspace
  writes, no browser opener. Online, the routing library is cached only in the plugin's temp cache
  (`<tmp>/paseo-plugin-drawio-cache/drawio-mcp/libavoid-routing.json`, fixed URL
  `viewer.diagrams.net/js/libavoid-js/libavoid-routing.js`, no diagram data by source).
- Fixed my tests: c0040 fixture precondition (now 7.23 MB inflated + 1.51 MB plain; passes on `f157b4f3`,
  fails on the `70185c97` production files in a throwaway copy); `launcher.test.ts` expects the six-tool
  contract and kills every spawned process in `after`/`finally` (the 600 s hang came from a failed
  assertion leaving a session alive; no leftover processes were found).
- DTD contract RED (`tests/unit/xml-source.test.ts`, `shared/xml-source.ts` `prepareDiagramXml` not
  written yet): identity without DOCTYPE; 2,000,000-character raw bound; single and nested internal
  entities; entity as page payload; CDATA/numeric/attribute meaning; SYSTEM/PUBLIC/parameter/external
  subset fail closed as `external-entity`; malformed as `invalid-xml`; quadratic, exponential and cyclic
  cases run in a worker with a 256 MB heap cap and a 10 s limit (harness checked against a looping stub).
- Proposed parser `fast-xml-parser` 5.12.0 (MIT), read from source only (`.validation/s1/fxp-inspect`,
  fetched from the configured registry `registry.npmjs.org`, not installed): entity count/size and
  expansion count/length limits exist and are checked after each replacement (bounded materialization);
  SYSTEM and `%` entity declarations throw. Gaps against the contract: entity values containing `&` are
  silently dropped (no nested entities), values flagged by `is-unsafe` (markup, chained references) are
  silently omitted instead of failing, and the parser returns an object tree, so canonical XML needs a
  separate serializer with order and CDATA preserved.

Earlier status at `085f8533`:

Adapter RED phase on `085f8533` (production tree as `5a2eb60`, plus the adapter plan): `npm test` 115 tests,
95 pass, 6 fail, 14 skipped, exit 1 (`.validation/s1/test-run-adapter-red.txt`).
- Import-level RED (module not written yet): `tests/unit/prepare-xml.test.ts` (1 fail, 8 skipped until
  `server/launcher/prepare-xml.mjs` exists) and `tests/process/prepare-adapter.test.ts` (1 fail, 6 skipped).
  Expectations were checked against the official functions run directly, offline (network-denied sandbox,
  WAR ELK bundle via `DRAWIO_ELK_URL`, no cache writes): repair drops surrounding text, escapes `&`, adds
  the edge geometry; ELK vertical chain y 12/82/152, horizontal x 12/122/232. No routing assertion (owner
  decision pending).
- Review RED (`tests/unit/final-review.test.ts`): c0040 uncompressed page counted in the inflated budget;
  c0041 whitespace-padded source over 2,000,000 renders; c0042 `#a0b0c0` and `#f5f5f5` read as dark.
- Test fixes, now passing: c0044 stream cut before the closing fence (pending row asserted); c0053 relay
  exceptions surface; c0054 refusal asserts nothing sent and the request repeated; c0058 batch reply and
  notification settled by observed replies, no sleep; c0057 offline shape search exits 1 on error or no
  result (checked with a failing fake server); c0045 generator writes `names.txt`, runner derives names when
  absent (fresh directory: 22 variants, 0 failures, exit 0).
- c0043 measured, not tested: one 100,000-char internal entity referenced 1,000 times (103 KB source)
  expands to 100,000,000 chars in about 1 s with no parser refusal (`.validation/s1/c0043-dtd-parse-cost.json`,
  `tests/acceptance/dtd-parse-cost.mjs`). Growth is linear, so the 2,000,000-char source bound alone allows
  expansion of about 1.9 G chars inside the frame. No policy chosen here.

Earlier status at `ef4dc14d`:

Latest: production `ef4dc14df96d6a986baca0b0bee2a61470b4c81b` (tree `f8283454…`). `npm test` 95/95, exit 0
(`.validation/s1/test-run-ef4d-r.txt`), the same with a different HOME and minimal PATH. The authoritative
expansion bound is now in the viewer frame: it inflates each page's browser-parsed `textContent` with the
viewer's pako before any viewer element is created. Verified with the production `buildFrameHtml` and the
pinned viewer in a task headless Chrome (DNS blocked): all 11 small variants render, all 11 over-limit
variants (including DTD entity, PI split, child text, unescaped `>`) show the size notice with no
`.mxgraph` element or SVG; a 3-page document of 4.75 MB per page (14.3 MB total) is refused; a 2-page small
document renders 2 pages; a malformed over-limit file shows the parse error. Negative control: with the
check removed from a throwaway copy of the frame HTML, over-limit pages render. Evidence:
`.validation/s1/c0006-3408/frame-expansion-{production,negative,extra}.json`, network log with no
diagram-content hosts. Script: `tests/acceptance/frame-expansion.mjs` (needs Chrome, not in `npm test`).
The Node prefilter no longer has a DTD case: it does not expand DTD entities by design, and the frame
placement is asserted in `tests/unit/frame-html.test.ts`.

Earlier status at `340862c3`:

- Latest production tested: `340862c30b7006f4001e6ffed84051e713f14653` (tree `e80aead4…`). Tests are
  unchanged by the author since `09c77c28`.
- `npm test` on it with the corrective tests: **95 tests, 90 pass, 5 fail (RED), exit 1**
  (`.validation/s1/test-run-3408-r.txt`). Without the five new cases the author's 90/90 reproduces
  (`.validation/s1/test-run-3408.txt`).
- Verified GREEN on `340862c3`: launcher survives writes after the Tool Server stops reading
  (KensAI c0002), delivers a 3 MiB final reply whole (c0007), and the expansion gate now matches the
  viewer for character references (decimal and hex), CDATA, comment-split and mixed encodings (c0006).
  Small variants are accepted.
- **RED, confirmed against the pinned viewer decoder** (`Editor.parseDiagramNode` in headless Chrome,
  each over-limit page decoded to 120,002 cells / 12,480,085 chars while the gate returned `ok`):
  base64 text beside an element child; base64 inside a child element; a processing instruction
  splitting the base64; an unescaped `>` in a `<diagram>` attribute; base64 supplied by an internal DTD
  entity. Tests: `tests/unit/expansion-gate.test.ts`; evidence: `.validation/s1/c0006-3408/summary.txt`,
  `plugin-gate.json`, `viewer-decode.json`; generator `tests/acceptance/expansion-variants.mjs`.
- Loader: `.tsx` is compiled with the declared `typescript`; the suite runs with a different HOME and a
  minimal PATH (no Paseo install path).
- The "Remaining" list and the defect lists below are historical (revisions `012014af`–`a1e7887e`).

## Historical: first test pass

Production revision under test: `012014af` (production), `4f3f3e57` (report), tree clean before tests.
Production source was not edited. Status: **PARTIAL**. Unit and real-process tests written and run.
Isolated Paseo runtime acceptance **NOT STARTED** (turn budget spent; see Remaining).

## How to run

```
npm test     # node --experimental-transform-types + tests/support/register.mjs, node:test
```

No new dependencies. Node 24.22.0. `tests/support/register.mjs` resolves extensionless `.ts`
imports, loads `.txt` as text, compiles `.tsx` with the declared `typescript` devDependency
(`transpileModule`, `react-jsx`), and stubs `react-native` and the host UI modules
(`@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`), as Paseo's bundler would. No
machine-specific tool path is used. Full output: `.validation/s1/test-run-spec.txt` (ignored, local).

## Result

`npm test` exit **1**: 67 tests, 62 pass, **5 fail**. `tsc --noEmit` exit 0.
`npm pack --dry-run`: 27 files; none from `tests/`, `.spikes/`, `.validation/`, `docs/`, `DESIGN*`.

| File | Covers |
|---|---|
| `tests/unit/fences.test.ts` | CommonMark fences: backtick/tilde, info strings, longer/inner fences, indentation, 4-space code, nested in other fences, block quote, list items, CRLF, unclosed, empty; every streamed prefix of a 2-diagram reply (unique ids, stable id family), half-typed closer |
| `tests/unit/diagram.test.ts` | empty, XML decl, BOM, leading comment, non-draw.io, size boundary, pages, compressed |
| `tests/unit/frame-budget.test.ts` | LRU eviction once, pinned never evicted, pinned over limit, unpinned denied when only pinned live, recovery re-acquire, release |
| `tests/unit/frame-html.test.ts` | CSP has no remote origin; meta before scripts; XML script break-out; CSS injection via theme; links/lightbox off, dark mode; real 8.8 MB viewer intact after escaping |
| `tests/unit/server.test.ts` | viewer sha/size and tamper; plugin-root selection and ambiguity; hoisted npm layout; wrong version; injection gating, user `drawio` key kept, discovery failure never fails open; prompt contract |
| `tests/process/launcher.test.ts` | real launcher + real `@drawio/mcp` 1.10.1: tools vs upstream minus 3 openers, schemas, workspace cwd (`list_pages` relative), blocked calls (numeric/string/0 ids, `_` escape, JSON batch) with a PATH trap for `open`/`xdg-open` (never spawned), line framing, usage error, stdin close/SIGTERM/SIGKILL reap the child |

## Defects found (failing tests, production not changed)

1. **Fence inside a block quote is not rendered** (`> ```drawio`). CommonMark makes it a drawio code block; design requires every drawio fence.
2. **Fence starting on a list-marker line is not rendered** (`- ```drawio`).
3. **Fence in a wide ordered list item is not rendered** (`10. item` then 4-space indented fence): treated as indented code.
4. **`classifyDiagramXml` rejects a valid file with a leading XML comment** (`<!-- … --><mxfile>`) as "not draw.io".
5. **Launcher with a missing workspace prints a raw Node stack trace** (uncaught `chdir` ENOENT) instead of a one-line reason. Exit is non-zero; severity low.

## Verified facts (evidence, not assumed)

- Viewer asset = `js/viewer-static.min.js` from the S0 `draw.war` (same sha256 `dfa1cfb4…5928`, 8,808,136 B).
  S0 CDN build is sha256 `35b8ef54…f1a1`, 4,935,096 B. First differing byte 4,934,656 (not 4,932,632
  as reported): the WAR build inserts the embedded stencil library before the CDN tail
  (`mxStencilRegistry.allowEval=false`, service-worker guard, `onDrawioViewerLoad`/`processElements`),
  which appears later. Rendering equivalence still needs the runtime fixture matrix.
- Real viewer contains no `</script`; two `<!--` occur inside template literals (DOMPurify), where the
  `<\!--` escape is semantics-preserving.
- Launcher hides exactly the three openers; remaining 5 tools equal upstream minus openers (checked
  against an unwrapped upstream run, not a hard-coded count).

## Tool Server layout/normalization question (source evidence, `@drawio/mcp` 1.10.1)

- Repair (`repair-xml.js`), normalize (`normalize-model.js`), label perimeters (`label-perimeter.js`),
  ELK (`elk-pass.js`) and libavoid (`libavoid-pass.js`) run **only** inside the `open_drawio_*` handler
  (`src/index.js` ~957–1072). The handler then **unconditionally** calls `openBrowser(url)`
  (`spawn("open", [url])` on macOS, `xdg-open` on Linux, temp `.url`/`.html` + `cmd start` on Windows)
  and returns only an `app.diagrams.net` URL with the diagram deflated into it. No env, flag or
  argument disables the open, and no tool returns the processed XML. `set_page` does not normalize.
- So no official no-browser path exists that preserves these features. Options, all needing an owner decision:
  a) a Paseo-side tool that calls the official package's exported functions (`repairDiagramXml`,
     `normalizeDiagram`, `addLabelPerimeters`/`fitEdgeLabels`, `layoutXml`, `routeXml`) and returns XML.
     This is a custom mechanism over official code.
  b) Hide `open`/`xdg-open` from the Tool Server `PATH` so the spawn fails. Not recommended: the output
     is a URL, not usable XML; the response falsely says "opened"; Windows writes temp files and uses `cmd`.
  c) Upstream request for a no-open / return-XML mode.
- Network for those passes: ELK fetches `viewer.diagrams.net/js/elk/drawio-elk.min.js` unless
  `DRAWIO_ELK_URL` names a local file (official env). `draw.war` v32.6.10 ships `js/elk/drawio-elk.min.js`
  and `js/libavoid-js/libavoid-routing.js`. libavoid first fetches the routing core from
  `viewer.diagrams.net` (no URL override), then falls back to the vendored copy. Neither request carries
  diagram content.
- Separate egress point in the current build: `search_shapes` downloads the shape index from jsDelivr
  (`DRAWIO_SHAPE_INDEX_URL` can point at a local file). Production env does not set it. Not exercised
  by tests (no third-party traffic).

## `pluginRoot` / `config.get` (source only)

Not investigated this turn beyond the existing report; the projection alternatives remain open.

## Remaining (not covered, exact cause: turn budget)

Real Paseo compile by the test author; isolated daemon under `.validation/s1/runtime` with auth/relay off;
plugin install there; viewer RPC and auth deny; panel/timeline rendering and fixture matrix
(compressed, multipage, layers, embedded/external images, fonts, large) with egress capture; CSP;
frame budget in the browser; file change/delete; restart recovery; real provider launches
(claude/codex/opencode) with `list_pages` only; package relocation install; native export sample.
Headed, phone and remote: NOT COVERED.
