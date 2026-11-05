import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { buildToolServerEntry } from "../../server/toolserver";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LAUNCHER = path.join(ROOT, "server/launcher/drawio-toolserver.mjs");
const SERVER = path.join(ROOT, "node_modules/@drawio/mcp/src/index.js");
const BLOCKED = ["open_drawio_xml", "open_drawio_csv", "open_drawio_mermaid"];
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-s1-launch-")));
const workspace = path.join(scratch, "ws");
const trapDir = path.join(scratch, "trap");
const trapLog = path.join(scratch, "opener.log");
mkdirSync(path.join(workspace, "docs"), { recursive: true });
mkdirSync(trapDir);
// Any browser opener the Tool Server tries to spawn lands here instead of a real browser.
for (const name of ["open", "xdg-open"]) {
  writeFileSync(path.join(trapDir, name), `#!/bin/sh\necho "$0 $*" >> ${JSON.stringify(trapLog)}\n`);
  chmodSync(path.join(trapDir, name), 0o755);
}
const PAGE = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
writeFileSync(path.join(workspace, "docs/two.drawio"), `<mxfile><diagram id="p1" name="One">${PAGE}</diagram><diagram id="p2" name="Two">${PAGE}</diagram></mxfile>`);
const sessions = new Set<ChildProcessWithoutNullStreams>();
after(() => {
  for (const child of sessions) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  rmSync(scratch, { recursive: true, force: true });
});

type Rpc = { id?: unknown; result?: any; error?: any; method?: string };

class Session {
  readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  readonly messages: Rpc[] = [];
  readonly raw: string[] = [];
  stderr = "";
  private waiters: Array<() => void> = [];

  constructor(argv: string[], cwd = scratch) {
    const entry = buildToolServerEntry({ execPath: process.execPath, launcherPath: LAUNCHER, serverEntry: SERVER, cwd: workspace }) as any;
    const env = { ...process.env, ...entry.env, PATH: `${trapDir}:${process.env.PATH}` };
    this.child = spawn(process.execPath, argv, { cwd, env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    sessions.add(this.child);
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.raw.push(line);
        try { this.messages.push(JSON.parse(line)); } catch { /* non-JSON stays in raw */ }
        this.waiters.splice(0).forEach((w) => w());
      }
    });
    this.child.stderr.on("data", (c) => (this.stderr += c));
  }

  static launch() {
    return new Session([LAUNCHER, workspace, SERVER]);
  }

  send(message: unknown) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async reply(id: unknown, timeout = 15_000): Promise<Rpc> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = this.messages.find((m) => m.id === id && ("result" in m || "error" in m));
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no reply for ${String(id)}; stderr=${this.stderr.slice(-400)}`);
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 200); });
    }
  }

  async init() {
    this.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "s1-test", version: "0" } } });
    const init = await this.reply(1);
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return init;
  }

  exited(timeout = 5000): Promise<{ code: number | null; signal: string | null } | null> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve({ code: this.child.exitCode, signal: this.child.signalCode });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      this.child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
  }
}

function childPids(pid: number): number[] {
  try {
    return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(Number);
  } catch { return []; }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid: number, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 100)); }
  return !alive(pid);
}

async function upstreamTools(): Promise<string[]> {
  const s = new Session([SERVER]);
  await s.init();
  s.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = (await s.reply(2)).result.tools.map((t: { name: string }) => t.name);
  s.child.kill("SIGTERM");
  await s.exited();
  return names;
}

describe("Tool Server launcher (real process, pinned @drawio/mcp)", () => {
  it("exposes every upstream tool except the browser openers, with strict object schemas", async () => {
    const upstream = await upstreamTools();
    for (const name of BLOCKED) assert.ok(upstream.includes(name), `upstream no longer has ${name}`);
    const s = Session.launch();
    const init = await s.init();
    assert.match(init.result.instructions, /fenced block whose language is drawio/);
    s.send({ jsonrpc: "2.0", id: "list", method: "tools/list" });
    try {
      const tools = (await s.reply("list")).result.tools as Array<{ name: string; inputSchema: any }>;
      // The relay serves prepare_drawio_xml itself; the official tools pass through unchanged.
      assert.deepEqual(tools.map((t) => t.name).sort(), [...upstream.filter((n) => !BLOCKED.includes(n)), "prepare_drawio_xml"].sort());
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, "object", tool.name);
        for (const req of tool.inputSchema.required ?? []) assert.ok(req in tool.inputSchema.properties, `${tool.name}.${req}`);
      }
      const prepare = tools.find((t) => t.name === "prepare_drawio_xml")!;
      assert.deepEqual(prepare.inputSchema.required, ["content"]);
      assert.deepEqual(Object.keys(prepare.inputSchema.properties).sort(), ["content", "direction", "postLayout", "routing"]);
    } finally {
      s.child.kill("SIGTERM");
      await s.exited();
    }
  });

  it("runs tools in the agent workspace: relative paths resolve there", async () => {
    const s = Session.launch();
    await s.init();
    s.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_pages", arguments: { path: "docs/two.drawio" } } });
    const result = (await s.reply(3)).result;
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.match(result.content[0].text, /One[\s\S]*Two/);
    s.child.kill("SIGTERM");
    await s.exited();
  });

  it("refuses blocked tools under every id form and never spawns a browser opener", async () => {
    const s = Session.launch();
    await s.init();
    const ids = [10, "s-11", 0];
    for (const [i, name] of BLOCKED.entries()) {
      s.send({ jsonrpc: "2.0", id: ids[i], method: "tools/call", params: { name, arguments: { content: PAGE } } });
      const reply = await s.reply(ids[i]);
      assert.equal(reply.result.isError, true);
      assert.match(reply.result.content[0].text, /disabled in Paseo/);
    }
    // An escaped tool name is the same name after JSON decoding.
    s.child.stdin.write('{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"open_drawio\\u005fxml","arguments":{"content":"<mxGraphModel/>"}}}\n');
    assert.equal((await s.reply(12)).result.isError, true);
    // A JSON-RPC batch must not smuggle a blocked call past the relay.
    s.child.stdin.write(JSON.stringify([{ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "open_drawio_xml", arguments: { content: PAGE } } }]) + "\n");
    // A notification-form call (no id) must not reach the Tool Server's opener either.
    s.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "open_drawio_xml", arguments: { content: PAGE } } }) + "\n");
    // The batch is answered by the relay (a JSON array line); the notification gets no reply, so a
    // later request settles that everything before it was processed.
    const deadline = Date.now() + 15_000;
    let batchReply: string | undefined;
    while (!(batchReply = s.raw.find((l) => /"id":\s*13\b/.test(l))) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    assert.ok(batchReply, "no reply to the batched blocked call");
    assert.ok(!/diagrams\.net/.test(batchReply!), `batch reached upstream: ${batchReply!.slice(0, 200)}`);
    assert.match(batchReply!, /disabled in Paseo/);
    s.send({ jsonrpc: "2.0", id: 14, method: "tools/list" });
    await s.reply(14);
    assert.ok(!existsSync(trapLog), `browser opener was spawned: ${existsSync(trapLog) ? readFileSync(trapLog, "utf8") : ""}`);
    s.child.kill("SIGTERM");
    await s.exited();
  });

  it("frames messages split across writes and several messages in one write", async () => {
    const s = Session.launch();
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    s.child.stdin.write(init.slice(0, 17));
    await new Promise((r) => setTimeout(r, 50));
    s.child.stdin.write(init.slice(17) + "\n" + JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n" + JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    assert.ok((await s.reply(1)).result.instructions);
    assert.ok(!(await s.reply(2)).result.tools.some((t: { name: string }) => BLOCKED.includes(t.name)));
    s.child.kill("SIGTERM");
    await s.exited();
  });

  it("exits with a usage error when arguments are missing", async () => {
    const s = new Session([LAUNCHER]);
    const exit = await s.exited();
    assert.equal(exit?.code, 2);
    assert.match(s.stderr, /expected <workspace-cwd> <tool-server-entry>/);
  });

  it("fails cleanly (non-zero, one-line reason) for a missing workspace or server entry", async () => {
    const missingCwd = new Session([LAUNCHER, path.join(scratch, "nope"), SERVER]);
    const a = await missingCwd.exited();
    assert.notEqual(a?.code, 0);
    const missingEntry = new Session([LAUNCHER, workspace, path.join(scratch, "nope.js")]);
    const b = await missingEntry.exited();
    assert.notEqual(b?.code, 0);
    assert.ok(missingCwd.stderr.split("\n").filter(Boolean).length <= 3, `stack trace leaked: ${missingCwd.stderr.slice(0, 300)}`);
  });

  it("exits and reaps the Tool Server when the client closes stdin", async () => {
    const s = Session.launch();
    await s.init();
    const kids = childPids(s.child.pid!);
    assert.equal(kids.length, 1);
    s.child.stdin.end();
    assert.ok(await s.exited(8000), "launcher still running after stdin closed");
    assert.ok(await gone(kids[0]!), "Tool Server orphaned after stdin closed");
  });

  it("forwards SIGTERM and leaves no Tool Server behind", async () => {
    const s = Session.launch();
    await s.init();
    const [kid] = childPids(s.child.pid!);
    s.child.kill("SIGTERM");
    assert.ok(await s.exited(5000));
    assert.ok(await gone(kid!));
  });

  it("leaves no Tool Server behind when the launcher is killed outright", async () => {
    const s = Session.launch();
    await s.init();
    const [kid] = childPids(s.child.pid!);
    s.child.kill("SIGKILL");
    await s.exited();
    const reaped = await gone(kid!, 8000);
    if (!reaped) process.kill(kid!, "SIGKILL");
    assert.ok(reaped, `Tool Server ${kid} orphaned after launcher SIGKILL`);
  });
});
