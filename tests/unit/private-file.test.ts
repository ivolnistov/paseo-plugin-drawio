import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrivateFile } from "../../server/launcher/user-cache.mjs";

// Simulated stat objects; this does not run on Windows. Windows reports writable files as mode 0666
// and has no POSIX group/other bits, so only the file type can be checked there.
const uid = typeof process.getuid === "function" ? process.getuid() : 501;
const stat = (kind: "file" | "link" | "dir", mode: number, owner = uid) => ({
  isFile: () => kind === "file",
  isSymbolicLink: () => kind === "link",
  isDirectory: () => kind === "dir",
  mode,
  uid: owner,
});

describe("isPrivateFile platform rules", () => {
  it("accepts a regular writable file on win32 (mode 0666) and rejects links and directories", () => {
    assert.equal(isPrivateFile(stat("file", 0o100666), "win32"), true);
    assert.equal(isPrivateFile(stat("link", 0o120666), "win32"), false);
    assert.equal(isPrivateFile(stat("dir", 0o040777), "win32"), false);
  });

  it("keeps the Unix checks: own regular file without group/other write only", () => {
    assert.equal(isPrivateFile(stat("file", 0o100600), "linux"), true);
    assert.equal(isPrivateFile(stat("file", 0o100644), "darwin"), true);
    assert.equal(isPrivateFile(stat("file", 0o100620), "linux"), false, "group-writable accepted");
    assert.equal(isPrivateFile(stat("file", 0o100602), "darwin"), false, "world-writable accepted");
    assert.equal(isPrivateFile(stat("link", 0o120600), "linux"), false, "symlink accepted");
    if (typeof process.getuid === "function") {
      assert.equal(isPrivateFile(stat("file", 0o100600, uid + 1), "linux"), false, "foreign owner accepted");
    }
  });
});
