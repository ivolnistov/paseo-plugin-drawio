# Release readiness

Checked on 2026-11-05 against runtime source `21a9518d883202ab2e7792e535fc14077d5d762a`. Publication changes add documentation, screenshots, an example, a license entry point and listing/package metadata. Runtime code and installed dependency versions are unchanged.

## Verified locally

- `npm ci --ignore-scripts --no-audit --no-fund`: succeeded.
- `npm run typecheck`: succeeded.
- Existing unit and process suite on Node 22.18.0: **168 passed, 0 failed, 0 skipped**, with the pinned ELK bundle supplied through `S1_ELK_FIXTURE`.
- ELK fixture SHA-256: `25847b1ded5d2fed2e175ec0d781d6e36b6d2971d29d3959c6aac70ddfedd394`.
- `npm pack --dry-run --ignore-scripts`: required runtime entries, local modules, bundled viewer, shape index, shrinkwrap, notices, licenses, overview, README, example and both declared images are present.
- `git diff --check`: clean.
- Root `LICENSE`, package metadata and the shrinkwrap root entry declare MIT for the plugin’s original code. Third-party licenses and notices are preserved.

The repository's test script uses `--experimental-transform-types`, which Node 26 no longer accepts. The suite was therefore run with Node 22.18.0; the test script was not changed.

## Screenshot runtime

The two screenshots were captured from the actual plugin at the source above in an isolated Paseo 0.15.0 daemon and desktop-sized Chromium browser. The workspace and streamed assistant reply use a synthetic service-flow example; no model inference was used. The plugin reported `running`, and both the file panel and inline diagram rendered. The temporary daemon and browser were stopped after capture. The shared daemon configuration remained unchanged.

This capture is a UI check, not a repeat of every runtime acceptance scenario. It did not exercise a new managed Git installation, real-provider tool injection, a phone, or a remote client. Earlier runtime evidence and its limits remain in `docs/reports/`.

## Publication state

These materials are local drafts pending owner approval. No release, npm package, registry issue or review PR has been published by this preparation task. The GitHub repository remains private.

Before public listing, address the routing-library runtime-download confirmation requirement, disposition the optional ELK source-availability question recorded in `NOTICE.md`, and obtain the owner's decision on exposure of historical author contact/hostname metadata, checkpoint branches and internal reports. The complete release checklist and submission destination are in [PUBLISHING.md](PUBLISHING.md). The submission draft follows the live form's Source and Categories fields.
