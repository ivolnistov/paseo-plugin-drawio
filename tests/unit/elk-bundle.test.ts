import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createServer } from "node:http";
import { ELK_BYTES, ELK_SHA256, loadElkFixture, sha256, startElkServer } from "../support/elk-fixture.ts";

// Contract (owner decision): the ELK bundle is not shipped. Installation or an explicit preparation
// step downloads it into a private per-user cache, accepts it only if it matches the pinned SHA-256,
// and afterwards uses the verified local file without any network check. A changed or broken download
// never replaces a verified copy.
//
// Proposed module server/launcher/elk-bundle.mjs:
//   ELK_BUNDLE_SHA256: string            pinned hash
//   ELK_BUNDLE_URL: string               official https URL
//   elkBundlePath(cacheHome?): string    file location inside cacheHome (default: the launcher's PREPARE_CACHE_HOME)
//   verifiedElkBundle(cacheHome?): Promise<string | null>   path when the cached file matches the pin; no network
//   prepareElkBundle({ cacheHome?, url?, force? }): Promise<   (force: download again even when verified)
//     { status: "ok", path, downloaded: boolean } |
//     { status: "error", code: "download-failed" | "hash-mismatch", message, path: string | null }>
//   (on error, path is the retained verified copy, if any)
const ROOT = path.resolve(import.meta.dirname, "../..");
const MODULE = path.join(ROOT, "server/launcher/elk-bundle.mjs");
const mod: any = existsSync(MODULE) ? await import("../../server/launcher/elk-bundle.mjs").catch((e) => e) : new Error("server/launcher/elk-bundle.mjs does not exist");
const fixture = loadElkFixture();
const moduleSkip = mod instanceof Error ? `ELK preparation not implemented: ${mod.message.split("\n")[0]}` : false;
const skip = mod instanceof Error ? `ELK preparation not implemented: ${mod.message.split("\n")[0]}` : !fixture ? "pinned ELK bytes unavailable (set S1_ELK_FIXTURE)" : false;

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-s1-elk-")));
let server: Awaited<ReturnType<typeof startElkServer>> | null = null;
before(async () => { if (fixture) server = await startElkServer(fixture); });
after(async () => { await server?.close(); rmSync(scratch, { recursive: true, force: true }); });
let n = 0;
const freshCache = () => path.join(scratch, `cache-${++n}`);
const filesIn = (dir: string) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((f) => statSync(path.join(dir, f)).isFile()) : []);

describe("ELK bundle preparation", () => {
  it("module server/launcher/elk-bundle.mjs exists", () => {
    assert.equal(mod instanceof Error, false, mod instanceof Error ? mod.message : undefined);
  });

  it("pins the official bundle hash and an https URL", { skip: moduleSkip }, () => {
    assert.equal(mod.ELK_BUNDLE_SHA256, ELK_SHA256);
    assert.match(mod.ELK_BUNDLE_URL, /^https:\/\//);
  });

  it("prepares a verified copy in a private cache directory", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "good";
    const before = server!.state.requests;
    const r = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.downloaded, true);
    assert.equal(server!.state.requests - before, 1);
    assert.equal(r.path, mod.elkBundlePath(cacheHome));
    assert.ok(r.path.startsWith(cacheHome + path.sep), r.path);
    const bytes = readFileSync(r.path);
    assert.equal(bytes.length, ELK_BYTES);
    assert.equal(sha256(bytes), ELK_SHA256);
    assert.equal(statSync(cacheHome).mode & 0o777, 0o700, "cache directory is not private");
    assert.equal(statSync(r.path).mode & 0o022, 0, "bundle is group or world writable");
    assert.equal(await mod.verifiedElkBundle(cacheHome), r.path);
  });

  it("uses a warm verified cache with no network request", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "good";
    await mod.prepareElkBundle({ cacheHome, url: server!.url });
    server!.state.mode = "error";
    const before = server!.state.requests;
    const again = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    assert.equal(again.status, "ok", JSON.stringify(again));
    assert.equal(again.downloaded, false);
    assert.equal(await mod.verifiedElkBundle(cacheHome), again.path);
    assert.equal(server!.state.requests - before, 0, "a warm cache must not contact the network");
  });

  it("rejects a download that does not match the pin and keeps no file", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "tampered";
    const r = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    assert.equal(r.status, "error");
    assert.equal(r.code, "hash-mismatch");
    assert.equal(r.path, null);
    assert.equal(await mod.verifiedElkBundle(cacheHome), null);
    assert.equal(existsSync(mod.elkBundlePath(cacheHome)), false, "mismatching bytes were stored as the bundle");
  });

  it("never replaces a verified copy with a mismatching or failed forced download", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "good";
    const good = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    for (const [mode, code] of [["tampered", "hash-mismatch"], ["truncated", "download-failed"], ["error", "download-failed"]] as const) {
      server!.state.mode = mode;
      const before = server!.state.requests;
      const r = await mod.prepareElkBundle({ cacheHome, url: server!.url, force: true });
      assert.equal(server!.state.requests - before, 1, `${mode}: force must download`);
      assert.equal(r.status, "error", mode);
      assert.equal(r.code, code, mode);
      assert.equal(r.path, good.path, `${mode}: the verified copy is reported as retained`);
      assert.equal(sha256(readFileSync(good.path)), ELK_SHA256, `${mode}: verified copy changed`);
      assert.equal(await mod.verifiedElkBundle(cacheHome), good.path);
    }
  });

  it("does not trust a corrupted cached file and replaces it only with verified bytes", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "good";
    const first = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    writeFileSync(first.path, "console.log('tampered');");
    assert.equal(await mod.verifiedElkBundle(cacheHome), null, "corrupted cache was trusted");
    server!.state.mode = "tampered";
    const bad = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    assert.equal(bad.status, "error");
    assert.equal(await mod.verifiedElkBundle(cacheHome), null);
    server!.state.mode = "good";
    const repaired = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    assert.equal(repaired.status, "ok");
    assert.equal(repaired.downloaded, true);
    assert.equal(sha256(readFileSync(repaired.path)), ELK_SHA256);
  });

  it("accepts no partial file after an interrupted download", { skip }, async () => {
    for (const mode of ["truncated", "error"] as const) {
      const cacheHome = freshCache();
      server!.state.mode = mode;
      const r = await mod.prepareElkBundle({ cacheHome, url: server!.url });
      assert.equal(r.status, "error", mode);
      assert.equal(r.code, "download-failed", `${mode}: ${r.code}`);
      assert.equal(await mod.verifiedElkBundle(cacheHome), null);
      assert.equal(existsSync(mod.elkBundlePath(cacheHome)), false, `${mode}: partial file at the bundle path`);
      const leftovers = filesIn(cacheHome).filter((f) => statSync(path.join(cacheHome, f)).size > 0);
      assert.deepEqual(leftovers, [], `${mode}: partial download left behind`);
    }
  });

  it("defaults to the launcher's private per-user cache", { skip: moduleSkip }, async () => {
    const { PREPARE_CACHE_HOME } = await import("../../server/launcher/drawio-toolserver.mjs");
    assert.ok(mod.elkBundlePath().startsWith(PREPARE_CACHE_HOME + path.sep), mod.elkBundlePath());
  });

  it("does not trust a symlinked or group-writable cache file, even with the right bytes", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "good";
    const good = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    const elsewhere = path.join(scratch, `elsewhere-${n}.js`);
    writeFileSync(elsewhere, fixture!);
    chmodSync(elsewhere, 0o600);
    unlinkSync(good.path);
    symlinkSync(elsewhere, good.path);
    assert.equal(await mod.verifiedElkBundle(cacheHome), null, "symlinked bundle trusted");
    unlinkSync(good.path);
    writeFileSync(good.path, fixture!);
    chmodSync(good.path, 0o660);
    assert.equal(await mod.verifiedElkBundle(cacheHome), null, "group-writable bundle trusted");
  });

  it("ends concurrent preparations with one verified file and no temporary leftovers", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "good";
    const results = await Promise.all(Array.from({ length: 4 }, () => mod.prepareElkBundle({ cacheHome, url: server!.url })));
    for (const r of results) assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(await mod.verifiedElkBundle(cacheHome), mod.elkBundlePath(cacheHome));
    assert.deepEqual(filesIn(cacheHome), [path.relative(cacheHome, mod.elkBundlePath(cacheHome))]);
  });

  // A download that fails must report the cache as it is when the failure is returned, not as it
  // was when the call started: another preparation may have stored (or lost) a verified copy meanwhile.
  async function heldFailingServer() {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let arrived!: () => void;
    const requestArrived = new Promise<void>((r) => (arrived = r));
    const server = createServer(async (_req, res) => {
      arrived();
      await released;
      res.writeHead(500);
      res.end("unavailable");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}/elk.js`, requestArrived, release, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it("reports the verified copy stored by a concurrent preparation when its own download fails", { skip }, async () => {
    const cacheHome = freshCache();
    const held = await heldFailingServer();
    try {
      const failing = mod.prepareElkBundle({ cacheHome, url: held.url });
      await held.requestArrived;
      server!.state.mode = "good";
      const good = await mod.prepareElkBundle({ cacheHome, url: server!.url });
      assert.equal(good.status, "ok");
      held.release();
      const r = await failing;
      assert.equal(r.status, "error");
      assert.equal(r.code, "download-failed");
      assert.equal(r.path, good.path, "a stale 'no verified copy' was reported");
    } finally {
      held.release();
      await held.close();
    }
  });

  it("does not report a verified copy that was invalidated while its own download failed", { skip }, async () => {
    const cacheHome = freshCache();
    server!.state.mode = "good";
    const good = await mod.prepareElkBundle({ cacheHome, url: server!.url });
    const held = await heldFailingServer();
    try {
      const failing = mod.prepareElkBundle({ cacheHome, url: held.url, force: true });
      await held.requestArrived;
      writeFileSync(good.path, "console.log('tampered');");
      held.release();
      const r = await failing;
      assert.equal(r.status, "error");
      assert.equal(r.path, null, "an invalidated copy was reported as retained");
    } finally {
      held.release();
      await held.close();
    }
  });
});
