import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PREPARE_CACHE_HOME, userCacheHome } from "../../server/launcher/drawio-toolserver.mjs";

// The routing library cached here is evaluated later, so the directory must be the user's own cache
// location, never a fixed name under a shared temporary directory. Directory ownership and mode are
// checked separately (privateCacheDirectory in cache-and-reply.test.ts).
describe("prepare_drawio_xml routing cache location", () => {
  it("is the platform user cache directory for this process", () => {
    assert.equal(PREPARE_CACHE_HOME, userCacheHome(process.env, process.platform, homedir()));
    assert.notEqual(path.dirname(PREPARE_CACHE_HOME), tmpdir());
  });

  it("honours an absolute XDG_CACHE_HOME on Linux even outside the home directory (simulated inputs)", () => {
    assert.equal(userCacheHome({ XDG_CACHE_HOME: "/srv/cache" }, "linux", "/home/u"), "/srv/cache/paseo-plugin-drawio");
    assert.equal(userCacheHome({ XDG_CACHE_HOME: "/srv/cache" }, "darwin", "/Users/u"), "/Users/u/Library/Caches/paseo-plugin-drawio");
  });
});
