import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LAUNCHER = path.join(ROOT, "server/launcher/drawio-toolserver.mjs");
const FIXTURES = path.join(ROOT, "tests/fixtures/toolserver");
const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-s1-life-")));
after(() => rmSync(workspace, { recursive: true, force: true }));

function launch(entry: string, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [LAUNCHER, workspace, path.join(FIXTURES, entry)], {
    env: { ...process.env, PASEO_DRAWIO_INSTRUCTIONS: "x", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => (stderr += c));
  // "close" waits for the launcher's stdio to end, so all of its output has been read.
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  exited.then(() => clearTimeout(timeout));
  return { child, exited, stderr: () => stderr };
}

describe("launcher with a misbehaving Tool Server (real child processes)", () => {
  it("survives writes to a Tool Server that closed its stdin, without an uncaught exception", async () => {
    const { child, exited, stderr } = launch("closes-stdin.mjs");
    child.stdout.resume();
    child.stdin.on("error", () => {});
    const line = JSON.stringify({ jsonrpc: "2.0", method: "notifications/ping", params: { pad: "p".repeat(64 * 1024) } }) + "\n";
    const pump = setInterval(() => child.stdin.writable && child.stdin.write(line), 20);
    const { code } = await exited;
    clearInterval(pump);
    assert.doesNotMatch(stderr(), /\n\s+at |ERR_STREAM_DESTROYED|Unhandled 'error' event|EPIPE.*\n.*at /, `uncaught pipe error:\n${stderr().slice(0, 600)}`);
    assert.equal(code, 0, `launcher exit ${code}; stderr: ${stderr().slice(0, 300)}`);
  });

  it("delivers a large final reply completely before exiting", async () => {
    // The Tool Server answers and exits at once; the launcher must flush its own stdout first.
    const bytes = 3 * 1024 * 1024;
    const { child, exited } = launch("big-reply-then-exit.mjs", { S1_REPLY_BYTES: String(bytes) });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }) + "\n");
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    await exited;
    const line = out.split("\n")[0]!;
    assert.ok(line.length > bytes, `received ${out.length} of more than ${bytes} bytes`);
    assert.equal(JSON.parse(line).id, 7);
  });
});
