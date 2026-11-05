import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { MCP_SERVER_KEY, VIEWER_SHA256 } from "../../shared/constants";
import { buildDrawioPrompt, DRAWIO_AGENT_INSTRUCTIONS } from "../../shared/prompt";
import { shouldInjectToolServer } from "../../shared/providers";
import { resolveToolServerFiles, selectPluginRoot } from "../../server/plugin-root";
import { buildToolServerEntry, createToolServerInjector } from "../../server/toolserver";
import { sha256Hex, verifyViewerSource } from "../../server/viewer-asset";

const ROOT = path.resolve(import.meta.dirname, "../..");
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-s1-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

describe("pinned viewer asset", () => {
  it("is the exact pinned 8,808,136-byte build and the integrity check rejects any change", () => {
    const source = readFileSync(path.join(ROOT, "server/assets/viewer-static.min.js.txt"), "utf8");
    assert.equal(Buffer.byteLength(source), 8_808_136);
    assert.equal(sha256Hex(source), VIEWER_SHA256);
    assert.doesNotThrow(() => verifyViewerSource(source));
    assert.throws(() => verifyViewerSource(source + " "), /integrity/);
  });
});

describe("plugin root discovery", () => {
  const names: Record<string, string | null> = { "/a": "paseo-plugin-drawio", "/b": "paseo-plugin-drawio", "/c": "other", "/d": null };
  const probe = (dir: string) => names[dir] ?? null;

  it("prefers the default install id and ignores same-id plugins of another package", () => {
    assert.equal(selectPluginRoot([{ id: "x", path: "/a" }, { id: "drawio", path: "/b" }], probe), "/b");
    assert.equal(selectPluginRoot([{ id: "drawio", path: "/c" }, { id: "mine", path: "/a" }], probe), "/a");
  });

  it("refuses to guess between two installs of this package under other ids", () => {
    assert.equal(selectPluginRoot([{ id: "x", path: "/a" }, { id: "y", path: "/b" }], probe), null);
  });

  it("skips disabled installs and unreadable directories", () => {
    assert.equal(selectPluginRoot([{ id: "drawio", path: "/a", enabled: false }, { id: "y", path: "/b" }], probe), "/b");
    assert.equal(selectPluginRoot([{ id: "drawio", path: "/d" }], probe), null);
  });

  it("resolves the Tool Server from the repository checkout", () => {
    const files = resolveToolServerFiles(ROOT);
    assert.ok(!("error" in files), JSON.stringify(files));
    assert.equal(files.launcherPath, path.join(ROOT, "server/launcher/drawio-toolserver.mjs"));
    assert.equal(files.serverEntry, path.join(ROOT, "node_modules/@drawio/mcp/src/index.js"));
  });

  function layout(name: string, version: string, hoisted: boolean) {
    const top = path.join(scratch, name);
    const plugin = hoisted ? path.join(top, "node_modules", "paseo-plugin-drawio") : top;
    mkdirSync(path.join(plugin, "server/launcher"), { recursive: true });
    writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "paseo-plugin-drawio" }));
    writeFileSync(path.join(plugin, "server/launcher/drawio-toolserver.mjs"), "");
    const mcp = path.join(hoisted ? top : plugin, "node_modules/@drawio/mcp");
    mkdirSync(mcp, { recursive: true });
    writeFileSync(path.join(mcp, "package.json"), JSON.stringify({ name: "@drawio/mcp", version, bin: { "drawio-mcp": "./src/index.js" } }));
    return { plugin, mcp };
  }

  it("resolves a dependency hoisted beside a managed npm install", () => {
    const { plugin, mcp } = layout("hoisted", "1.10.1", true);
    const files = resolveToolServerFiles(plugin);
    assert.ok(!("error" in files));
    assert.equal(files.serverEntry, path.join(mcp, "src/index.js"));
  });

  it("refuses an unpinned Tool Server version and a missing install with a reason", () => {
    assert.match((resolveToolServerFiles(layout("wrong", "1.10.2", false).plugin) as { error: string }).error, /1\.10\.2 found/);
    const bare = path.join(scratch, "bare");
    mkdirSync(path.join(bare, "server/launcher"), { recursive: true });
    writeFileSync(path.join(bare, "server/launcher/drawio-toolserver.mjs"), "");
    writeFileSync(path.join(bare, "package.json"), "{}");
    assert.match((resolveToolServerFiles(bare) as { error: string }).error, /not installed/);
  });
});

describe("Tool Server injection", () => {
  const request = (provider: string, purpose: "interactive" | "history" = "interactive") =>
    ({ provider, purpose, cwd: "/work/space", mcpServers: { drawio: { type: "stdio", command: "user-drawio" } } }) as never;
  const files = { root: "/p", launcherPath: "/p/server/launcher/drawio-toolserver.mjs", serverEntry: "/p/node_modules/@drawio/mcp/src/index.js" };

  it("targets only interactive sessions of MCP-capable providers with a workspace", () => {
    assert.equal(shouldInjectToolServer({ provider: "claude", purpose: "interactive", cwd: "/w" }), true);
    assert.equal(shouldInjectToolServer({ provider: "claude", purpose: "history", cwd: "/w" }), false);
    assert.equal(shouldInjectToolServer({ provider: "claude", purpose: "interactive", cwd: "" }), false);
    assert.equal(shouldInjectToolServer({ provider: "my-custom-acp", purpose: "interactive", cwd: "/w" }), false);
  });

  it("builds a stdio entry that pins cwd through the launcher and closes third-party endpoints", () => {
    const entry = buildToolServerEntry({ execPath: "/node", launcherPath: files.launcherPath, serverEntry: files.serverEntry, cwd: "/work/space" }) as Record<string, any>;
    assert.equal(entry.type, "stdio");
    assert.equal(entry.command, "/node");
    assert.deepEqual(entry.args, [files.launcherPath, "/work/space", files.serverEntry]);
    assert.equal(entry.env.DRAWIO_ICON_SERVICE_URL, "off");
    assert.match(entry.env.DRAWIO_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(entry.env.PASEO_DRAWIO_INSTRUCTIONS, DRAWIO_AGENT_INSTRUCTIONS);
  });

  it("adds its own key without replacing a user-configured drawio server", async () => {
    const inject = createToolServerInjector({ execPath: "/node", resolveFiles: () => files, log: () => {} });
    const out = (await inject(request("claude"), async () => [{ id: "drawio", path: ROOT }])) as any;
    assert.deepEqual(Object.keys(out.mcpServers).sort(), ["drawio", MCP_SERVER_KEY].sort());
    assert.equal(out.mcpServers.drawio.command, "user-drawio");
    assert.equal(out.cwd, "/work/space");
  });

  it("never fails an agent open when discovery fails, and retries discovery later", async () => {
    const logs: string[] = [];
    const inject = createToolServerInjector({ execPath: "/node", resolveFiles: () => files, log: (m) => logs.push(m) });
    assert.equal(await inject(request("claude"), async () => { throw new Error("config denied"); }), undefined);
    assert.equal(await inject(request("claude"), async () => []), undefined);
    assert.ok(await inject(request("claude"), async () => [{ id: "drawio", path: ROOT }]));
    assert.equal(logs.length, 2);
    assert.match(logs[0]!, /config denied/);
  });

  it("does not touch history or unsupported-provider opens at all", async () => {
    let loads = 0;
    const inject = createToolServerInjector({ execPath: "/node", resolveFiles: () => files, log: () => {} });
    assert.equal(await inject(request("claude", "history"), async () => { loads++; return []; }), undefined);
    assert.equal(await inject(request("pi"), async () => { loads++; return []; }), undefined);
    assert.equal(loads, 0);
  });
});

describe("/drawio prompt", () => {
  it("passes the request through and always carries the surface contract", () => {
    const prompt = buildDrawioPrompt("  login flow  ");
    assert.ok(prompt.includes("login flow"));
    assert.ok(prompt.endsWith(DRAWIO_AGENT_INSTRUCTIONS));
  });

  it("asks the agent to clarify instead of drawing when no request is given", () => {
    const prompt = buildDrawioPrompt("   ");
    assert.match(prompt, /Ask them/);
    assert.match(prompt, /Do not create a diagram/);
  });

  it("documents only tools the agent can actually call", () => {
    for (const tool of ["set_page", "list_pages", "get_page"]) assert.ok(DRAWIO_AGENT_INSTRUCTIONS.includes(tool));
    assert.ok(!/open_drawio_(xml|csv|mermaid)|postLayout|libavoid|\bELK\b/i.test(DRAWIO_AGENT_INSTRUCTIONS));
  });
});
