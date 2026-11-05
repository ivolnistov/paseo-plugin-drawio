import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { encodePrepareReply, privateCacheDirectory, userCacheHome } from "../../server/launcher/drawio-toolserver.mjs";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-s1-cache-")));
const fallbacks: string[] = [];
after(() => {
  for (const dir of fallbacks) rmSync(dir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});
const mode = (dir: string) => statSync(dir).mode & 0o777;

describe("routing cache location", () => {
  it("uses the platform's per-user cache directory", () => {
    assert.equal(userCacheHome({}, "darwin", "/Users/u"), "/Users/u/Library/Caches/paseo-plugin-drawio");
    assert.equal(userCacheHome({ XDG_CACHE_HOME: "/x/cache" }, "linux", "/home/u"), "/x/cache/paseo-plugin-drawio");
    assert.equal(userCacheHome({}, "linux", "/home/u"), "/home/u/.cache/paseo-plugin-drawio");
    assert.equal(userCacheHome({ XDG_CACHE_HOME: "relative/cache" }, "linux", "/home/u"), "/home/u/.cache/paseo-plugin-drawio", "a relative XDG_CACHE_HOME is ignored");
    for (const platform of ["darwin", "linux"]) {
      assert.ok(!userCacheHome({}, platform, "/home/u").startsWith(tmpdir()), platform);
    }
  });
});

describe("private cache directory", () => {
  it("creates a missing directory with mode 0700 and returns it", () => {
    const dir = path.join(scratch, "new", "cache");
    assert.equal(privateCacheDirectory(dir), dir);
    assert.equal(mode(dir), 0o700);
  });

  it("tightens an existing directory it owns to 0700", () => {
    const dir = path.join(scratch, "loose");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    assert.equal(privateCacheDirectory(dir), dir);
    assert.equal(mode(dir), 0o700);
  });

  it("refuses a symlink and uses a fresh private directory, leaving the target untouched", () => {
    const target = path.join(scratch, "target");
    mkdirSync(target, { mode: 0o755 });
    chmodSync(target, 0o755);
    const link = path.join(scratch, "link");
    symlinkSync(target, link);
    const got = privateCacheDirectory(link);
    fallbacks.push(got);
    assert.notEqual(got, link);
    assert.ok(!got.startsWith(target));
    assert.equal(lstatSync(got).isDirectory(), true);
    assert.equal(mode(got), 0o700);
    assert.equal(mode(target), 0o755, "symlink target changed");
  });

  it("refuses a path that is a file and uses a fresh private directory", () => {
    const file = path.join(scratch, "file");
    writeFileSync(file, "x");
    const got = privateCacheDirectory(file);
    fallbacks.push(got);
    assert.notEqual(got, file);
    assert.equal(mode(got), 0o700);
    assert.ok(existsSync(file));
  });
});

describe("prepare_drawio_xml reply size bound", () => {
  const parse = (line: string) => {
    assert.ok(line.endsWith("\n") && line.indexOf("\n") === line.length - 1, "one protocol line");
    return JSON.parse(line);
  };
  const ok = (text: string) => ({ content: [{ type: "text", text }] });

  it("leaves a reply under the limit unchanged", () => {
    const result = ok('<mxGraphModel a="&quot;"><root/></mxGraphModel>');
    assert.equal(encodePrepareReply(7, result, 10_000), `${JSON.stringify({ jsonrpc: "2.0", id: 7, result })}\n`);
  });

  it("counts UTF-8 bytes and JSON escaping, not characters", () => {
    const cjk = "图".repeat(400);
    assert.ok(JSON.stringify(cjk).length < 1000 && Buffer.byteLength(JSON.stringify(cjk)) > 1000);
    const refusedCjk = parse(encodePrepareReply("a-1", ok(cjk), 1000));
    assert.equal(refusedCjk.id, "a-1");
    assert.equal(refusedCjk.result.isError, true);
    const quotes = '"'.repeat(600);
    assert.ok(quotes.length < 1000 && JSON.stringify(quotes).length > 1000);
    assert.equal(parse(encodePrepareReply(2, ok(quotes), 1000)).result.isError, true);
  });

  it("replaces an over-limit 10 MiB reply with a short error for the same id, never truncated XML", () => {
    const xml = `<mxGraphModel><root>${"图".repeat(3_700_000)}</root></mxGraphModel>`;
    const line = encodePrepareReply(42, ok(xml));
    assert.ok(Buffer.byteLength(line) < 10 * 1024 * 1024);
    const reply = parse(line);
    assert.equal(reply.jsonrpc, "2.0");
    assert.equal(reply.id, 42);
    assert.equal(reply.result.isError, true);
    assert.ok(!reply.result.content.some((c: { text: string }) => c.text.includes("<mxGraphModel")), "partial XML returned");
    assert.ok(Buffer.byteLength(line) < 1000);
  });
});
