import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ELK_SHA256, sha256 } from "../support/elk-fixture.ts";

// Owner decision: the ELK bundle is not redistributed; it is downloaded and verified at install or
// preparation time. These checks pin the distribution side only, not how preparation is implemented.
const ROOT = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "paseo-plugin.json"), "utf8"));

describe("ELK distribution", () => {
  it("does not ship the ELK bundle in the repository or the package", () => {
    assert.equal(existsSync(path.join(ROOT, "server/assets/drawio-elk.min.js")), false, "server/assets/drawio-elk.min.js is still tracked");
    const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const shipped = packed[0].files.map((f: { path: string }) => f.path);
    for (const file of shipped) {
      if (!/\.(js|mjs|txt)$/.test(file)) continue;
      const bytes = readFileSync(path.join(ROOT, file));
      assert.notEqual(sha256(bytes), ELK_SHA256, `${file} is the ELK bundle`);
    }
  });

  it("runs an explicit preparation step after the dependency install in the managed build", () => {
    const build: string[][] = manifest.build ?? [];
    const install = build.findIndex((step) => step[0] === "npm" && step[1] === "ci");
    assert.ok(install >= 0, "managed build installs dependencies");
    const after = build.slice(install + 1);
    assert.ok(after.length > 0, "no preparation step after npm ci");
    // The preparation step must run code shipped with the plugin, so a directory install can run the
    // same command explicitly.
    const runsShippedFile = after.some((step) => step.some((arg) => /^(\.\/)?server\/.+\.m?js$/.test(arg) && existsSync(path.join(ROOT, arg))));
    const runsPackageScript = after.some((step) => step[0] === "npm" && step[1] === "run" && typeof JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts?.[step[2]!] === "string");
    assert.ok(runsShippedFile || runsPackageScript, `preparation step does not run a shipped file or package script: ${JSON.stringify(after)}`);
  });
});
