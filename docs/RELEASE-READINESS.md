# Release readiness

Checked locally on 2026-11-05. Publication materials include documentation, screenshots, an example, an icon, MIT licensing for the plugin's original code and listing/package metadata. Edge routing now uses the library bundled in the pinned `@drawio/mcp` package, without contacting the routing CDN. Installed dependency versions are unchanged.

## Verified locally

- `npm ci --ignore-scripts --no-audit --no-fund`: succeeded.
- `npm run typecheck`: succeeded.
- Unit and process suite on Node 24.22.1: **169 passed, 0 failed, 0 skipped**, with the pinned ELK bundle supplied through `S1_ELK_FIXTURE`.
- The new routing regression fails against the old worker. It verifies real obstacle-avoiding geometry, zero fetch attempts, no cache writes and no evaluation of an existing cached routing library. It passes on the new worker; the final test-helper cleanup was rechecked with the targeted test.
- ELK fixture SHA-256: `25847b1ded5d2fed2e175ec0d781d6e36b6d2971d29d3959c6aac70ddfedd394`.
- `npm pack --dry-run --ignore-scripts`: required runtime entries, local modules, bundled viewer, shape index, shrinkwrap, notices, licenses, overview, README, example and both declared images are present.
- `git diff --check`: clean.
- Root `LICENSE`, package metadata and the shrinkwrap root entry declare MIT for the plugin's original code; the copyright holder is Gaijin Entertainment. Third-party licenses and notices are preserved.

The repository's test script uses `--experimental-transform-types`, which Node 26 no longer accepts. GitHub Actions pins Node 22.18.0 and runs locked dependency installation, typecheck, verified ELK preparation, tests with a skip guard and a package dry run. The updated suite was validated locally on Node 24.22.1; the final candidate has not yet run on the hosted Node 22 runner.

## Screenshot runtime

The two screenshots were captured from the actual plugin at runtime source `21a9518d883202ab2e7792e535fc14077d5d762a` in an isolated Paseo 0.15.0 daemon and desktop-sized Chromium browser. The workspace and streamed assistant reply use a synthetic service-flow example; no model inference was used. The plugin reported `running`, and both the file panel and inline diagram rendered. The temporary daemon and browser were stopped after capture. The shared daemon configuration remained unchanged. The later routing-source change does not alter the viewer interface.

This capture is a UI check, not a repeat of every runtime acceptance scenario. It did not exercise a new managed Git installation, real-provider tool injection, a phone, or a remote client. Earlier runtime evidence and its limits remain in `docs/reports/`.

## Publication state

At this preparation check, the original materials have been pushed to the private repository; the icon, Actions workflow and bundled-routing follow-up are prepared locally. No public release, npm package, registry issue or registry review PR has been published.

The owner-authorized history squash and removal of six checkpoint branches are complete; a private recovery bundle preserves the old history. Current plans and reports remain in the tree. Routing no longer downloads code at runtime, so it needs no download-confirmation setting. The optional ELK source-availability uncertainty remains documented in `NOTICE.md`. Exact-revision code review, hosted CI, a fresh managed Git installation and final publication approval remain to be completed. The complete release checklist and submission destination are in [PUBLISHING.md](PUBLISHING.md).
