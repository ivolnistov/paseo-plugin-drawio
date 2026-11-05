import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { userCacheHome } from "../../server/launcher/drawio-toolserver.mjs";
import { buildToolServerEntry } from "../../server/toolserver";
import { loadElkFixture, startElkServer } from "../support/elk-fixture.ts";
import { killAllSpawned, McpProcess, vertexPositions, xmlProblem } from "../support/mcp-process.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LAUNCHER = path.join(ROOT, "server/launcher/drawio-toolserver.mjs");
const SERVER = path.join(ROOT, "node_modules/@drawio/mcp/src/index.js");
const implemented = existsSync(path.join(ROOT, "server/launcher/prepare-xml.mjs"));
const skip = implemented ? false : "prepare_drawio_xml is not implemented yet (server/launcher/prepare-xml.mjs missing)";
const BLOCKED = ["open_drawio_xml", "open_drawio_csv", "open_drawio_mermaid"];

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-s1-prep-")));
const workspace = path.join(scratch, "ws");
const trapDir = path.join(scratch, "trap");
const trapLog = path.join(scratch, "opener.log");
for (const dir of [workspace, trapDir]) mkdirSync(dir, { recursive: true });
for (const name of ["open", "xdg-open"]) {
  writeFileSync(path.join(trapDir, name), `#!/bin/sh\necho "$0 $*" >> ${JSON.stringify(trapLog)}\n`);
  chmodSync(path.join(trapDir, name), 0o755);
}
writeFileSync(path.join(workspace, "keep.drawio"), "<mxfile/>");
// ELK is no longer shipped once server/launcher/elk-bundle.mjs exists: each ELK test then prepares a
// verified copy in its scratch HOME from a local server holding the pinned bytes. Before that, the
// launcher still uses the shipped bundle.
const ELK_MODULE = path.join(ROOT, "server/launcher/elk-bundle.mjs");
const elk: any = existsSync(ELK_MODULE) ? await import("../../server/launcher/elk-bundle.mjs") : null;
const elkBytes = loadElkFixture();
let elkServer: Awaited<ReturnType<typeof startElkServer>> | null = null;
before(async () => { if (elk && elkBytes) elkServer = await startElkServer(elkBytes); });
after(async () => { await elkServer?.close(); });

after(() => {
  killAllSpawned();
  rmSync(scratch, { recursive: true, force: true });
});

// Every launcher gets its own scratch HOME, so the routing cache it uses (userCacheHome for that
// environment) is inside the test directory and the user's real cache is never touched.
let homes = 0;
const freshHome = () => {
  const home = path.join(scratch, `home-${++homes}`);
  mkdirSync(home, { recursive: true });
  return home;
};
const homeEnv = (home: string) => ({ HOME: home, XDG_CACHE_HOME: path.join(home, ".xdg-cache") });
const routingCacheFor = (home: string) => userCacheHome(homeEnv(home), process.platform, home);
const filesUnder = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((f) => statSync(path.join(dir, f)).isFile()) : [];

// ELK layout needs the pinned bytes, which are not tracked: without them the layout tests skip and say why.
const elkFixtureSkip = elk && !elkBytes ? "pinned ELK bytes unavailable (set S1_ELK_FIXTURE or add .validation/s1/fixtures/drawio-elk.min.js)" : false;

/** A scratch HOME whose private cache holds a verified ELK bundle when preparation is implemented. */
async function preparedHome(): Promise<string> {
  const home = freshHome();
  if (!elk) return home;
  assert.ok(elkServer, "pinned ELK bytes unavailable for preparation (set S1_ELK_FIXTURE)");
  const r = await elk.prepareElkBundle({ cacheHome: routingCacheFor(home), url: elkServer!.url });
  assert.equal(r.status, "ok", JSON.stringify(r));
  return home;
}

function launch(wrap?: string[], home = freshHome()) {
  const entry = buildToolServerEntry({ execPath: process.execPath, launcherPath: LAUNCHER, serverEntry: SERVER, cwd: workspace }) as any;
  const env = { ...process.env, ...entry.env, PATH: `${trapDir}:${process.env.PATH}`, ...homeEnv(home) };
  const argv = [LAUNCHER, workspace, SERVER];
  return wrap ? new McpProcess([...wrap.slice(1), process.execPath, ...argv], { env, command: wrap[0] }) : new McpProcess(argv, { env });
}
const v = (id: string, x: number, y: number) =>
  `<mxCell id="${id}" value="${id}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="80" height="40" as="geometry"/></mxCell>`;
const e = (id: string, s: string, t: string) => `<mxCell id="${id}" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const chain = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${v("A", 0, 0)}${v("B", 0, 0)}${v("C", 0, 0)}${e("e1", "A", "B")}${e("e2", "B", "C")}</root></mxGraphModel>`;
const text = (result: any) => (result?.content ?? []).map((c: any) => c.text ?? "").join("\n");
const snapshot = () => readdirSync(workspace).map((f) => `${f}:${statSync(path.join(workspace, f)).mtimeMs}`).sort().join("|");

describe("prepare_drawio_xml through the real launcher", () => {
  it("is implemented (server/launcher/prepare-xml.mjs exists)", () => {
    assert.ok(implemented, String(skip));
  });

  it("lists the five upstream tools plus prepare_drawio_xml and no browser openers", { skip }, async () => {
    const upstream = new McpProcess([SERVER]);
    await upstream.init();
    upstream.send({ id: "u", method: "tools/list" });
    const upstreamNames = (await upstream.reply("u")).result.tools.map((t: any) => t.name);
    upstream.child.kill("SIGTERM");
    await upstream.exited();
    const s = launch();
    await s.init();
    s.send({ id: "l", method: "tools/list" });
    const names = (await s.reply("l")).result.tools.map((t: any) => t.name).sort();
    assert.deepEqual(names, [...upstreamNames.filter((n: string) => !BLOCKED.includes(n)), "prepare_drawio_xml"].sort());
    s.child.kill("SIGTERM");
    await s.exited();
  });

  it("returns repaired, well-formed XML for messy input, without writes or a browser", { skip }, async () => {
    const before = snapshot();
    const s = launch();
    await s.init();
    const messy = `Here is the diagram:\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${v("A", 10, 10).replace('value="A"', 'value="R&D"')}${v("B", 200, 10)}<mxCell id="e1" edge="1" parent="1" source="A" target="B"/></root></mxGraphModel>\nHope this helps.`;
    const result = await s.call(1, "prepare_drawio_xml", { content: messy });
    assert.notEqual(result.isError, true, text(result));
    const xml = result.content[0].text;
    assert.equal(xmlProblem(xml), null, `not well-formed: ${xmlProblem(xml)}`);
    assert.ok(!/Here is the diagram|Hope this helps/.test(xml), "surrounding text removed");
    assert.match(xml, /value="R&amp;D"/);
    assert.match(/<mxCell[^>]*id="e1"[\s\S]*?(<\/mxCell>|\/>)/.exec(xml)![0], /<mxGeometry/, "edge gets a geometry");
    assert.equal(snapshot(), before, "workspace changed");
    assert.ok(!existsSync(trapLog), "a browser opener was spawned");
    s.child.kill("SIGTERM");
    await s.exited();
  });

  it("lays out with ELK: vertical stacks downwards, horizontal runs left to right", { skip: skip || elkFixtureSkip }, async () => {
    const s = launch(undefined, await preparedHome());
    await s.init();
    const vertical = vertexPositions((await s.call(2, "prepare_drawio_xml", { content: chain, postLayout: "elk" })).content[0].text);
    const horizontal = vertexPositions((await s.call(3, "prepare_drawio_xml", { content: chain, postLayout: "elk", direction: "horizontal" })).content[0].text);
    const [a, b, c] = ["A", "B", "C"].map((id) => vertical.get(id)!);
    assert.ok(a.y < b.y && b.y < c.y, `vertical: ${JSON.stringify([a, b, c])}`);
    const [ha, hb, hc] = ["A", "B", "C"].map((id) => horizontal.get(id)!);
    assert.ok(ha.x < hb.x && hb.x < hc.x, `horizontal: ${JSON.stringify([ha, hb, hc])}`);
    s.child.kill("SIGTERM");
    await s.exited();
  });

  it("refuses invalid calls without running anything", { skip }, async () => {
    const s = launch();
    await s.init();
    const tooBig = await s.call(4, "prepare_drawio_xml", { content: "x".repeat(2_000_001) });
    assert.equal(tooBig.isError, true);
    assert.match(text(tooBig), /content/);
    const orphan = await s.call(5, "prepare_drawio_xml", { content: chain, direction: "horizontal" });
    assert.equal(orphan.isError, true);
    assert.match(text(orphan), /direction/);
    const wrongType = await s.call(6, "prepare_drawio_xml", { content: { xml: chain } });
    assert.equal(wrongType.isError, true);
    s.child.kill("SIGTERM");
    await s.exited();
  });

  it("answers concurrent calls and leaves no process behind on exit", { skip }, async () => {
    // Layout is not what this checks; without the pinned bytes the ELK call answers with a note instead.
    const s = launch(undefined, elkFixtureSkip ? freshHome() : await preparedHome());
    await s.init();
    s.send({ id: 7, method: "tools/call", params: { name: "prepare_drawio_xml", arguments: { content: chain, postLayout: "elk" } } });
    s.send({ id: 8, method: "tools/call", params: { name: "prepare_drawio_xml", arguments: { content: chain } } });
    const [r7, r8] = await Promise.all([s.reply(7), s.reply(8)]);
    assert.notEqual(r7.result?.isError, true, JSON.stringify(r7).slice(0, 200));
    assert.notEqual(r8.result?.isError, true, JSON.stringify(r8).slice(0, 200));
    const kids = execFileSync("pgrep", ["-P", String(s.child.pid)], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(Number);
    s.child.stdin.end();
    assert.ok(await s.exited(15_000), "launcher still running after stdin closed");
    for (const pid of kids) assert.throws(() => process.kill(pid, 0), undefined, `child ${pid} left running`);
  });

  it("runs ELK with outbound network denied and writes no cache", { skip: skip || elkFixtureSkip || (process.platform !== "darwin" ? "sandbox-exec is macOS only" : false) }, async () => {
    const profile = path.join(scratch, "deny-net.sb");
    writeFileSync(profile, "(version 1)\n(allow default)\n(deny network-outbound (remote ip))\n(deny network-outbound (remote tcp))\n(deny network-outbound (remote udp))\n");
    const home = await preparedHome();
    const cacheBefore = filesUnder(routingCacheFor(home)).sort();
    const s = launch(["/usr/bin/sandbox-exec", "-f", profile], home);
    await s.init();
    const result = await s.call(9, "prepare_drawio_xml", { content: chain, postLayout: "elk" });
    assert.notEqual(result.isError, true, text(result));
    const pos = vertexPositions(result.content[0].text);
    assert.ok(pos.get("A")!.y < pos.get("C")!.y, "ELK ran offline");
    assert.ok(!/layout did not run/i.test(text(result)), text(result));
    const sideways = vertexPositions((await s.call(91, "prepare_drawio_xml", { content: chain, postLayout: "elk", direction: "horizontal" })).content[0].text);
    assert.ok(sideways.get("A")!.x < sideways.get("C")!.x, "horizontal ELK ran offline");
    assert.deepEqual(filesUnder(routingCacheFor(home)).sort(), cacheBefore, "ELK changed the cache");
    assert.deepEqual(filesUnder(path.join(home, ".xdg-cache")), [], "cache written");
    s.child.kill("SIGTERM");
    await s.exited();
  });

  // Owner decision R2: routing uses the official libavoid pass, whose routing library is fetched
  // without diagram data and falls back to the copy bundled with the Tool Server when offline.
  const blocked = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${v("A", 0, 100)}<mxCell id="B" value="B" vertex="1" parent="1"><mxGeometry x="200" y="60" width="80" height="120" as="geometry"/></mxCell>${v("C", 420, 100)}${e("e1", "A", "C")}</root></mxGraphModel>`;
  const routedEdge = (xml: string) => /<mxCell\b[^>]*id="e1"[\s\S]*?<\/mxCell>/.exec(xml)?.[0] ?? "";

  it("routes an edge around an obstacle with libavoid, without writes or a browser", { skip }, async () => {
    const before = snapshot();
    const s = launch();
    try {
      await s.init();
      const result = await s.call(10, "prepare_drawio_xml", { content: blocked, routing: "libavoid" });
      assert.notEqual(result.isError, true, text(result));
      const xml = result.content[0].text;
      assert.equal(xmlProblem(xml), null, `not well-formed: ${xmlProblem(xml)}`);
      const edge = routedEdge(xml);
      assert.match(edge, /libavoidRouting=1/, edge.slice(0, 300));
      assert.match(edge, /<Array as="points">[\s\S]*<mxPoint/, "routed edge has waypoints");
      const refused = await s.call(11, "prepare_drawio_xml", { content: blocked, routing: "orthogonal" });
      assert.equal(refused.isError, true);
      assert.match(text(refused), /routing/);
      assert.equal(snapshot(), before, "workspace changed");
      assert.ok(!existsSync(trapLog), "a browser opener was spawned");
    } finally {
      s.child.kill("SIGTERM");
      await s.exited();
    }
  });

  it("still routes with outbound network denied (bundled routing library)", { skip: skip || (process.platform !== "darwin" ? "sandbox-exec is macOS only" : false) }, async () => {
    const profile = path.join(scratch, "deny-net-routing.sb");
    writeFileSync(profile, "(version 1)\n(allow default)\n(deny network-outbound (remote ip))\n(deny network-outbound (remote tcp))\n(deny network-outbound (remote udp))\n");
    // A fresh HOME has no cached routing library, so the result can only come from the bundled copy.
    const home = freshHome();
    assert.deepEqual(filesUnder(routingCacheFor(home)), []);
    const s = launch(["/usr/bin/sandbox-exec", "-f", profile], home);
    try {
      await s.init();
      const result = await s.call(12, "prepare_drawio_xml", { content: blocked, routing: "libavoid" });
      assert.notEqual(result.isError, true, text(result));
      const edge = routedEdge(result.content[0].text);
      assert.match(edge, /libavoidRouting=1/);
      assert.match(edge, /<mxPoint/);
      assert.ok(!filesUnder(routingCacheFor(home)).some((f) => f.endsWith("libavoid-routing.json")), "downloaded while network was denied");
    } finally {
      s.child.kill("SIGTERM");
      await s.exited();
    }
  });

  const elkSkip = skip || (!elk ? "ELK preparation not implemented (server/launcher/elk-bundle.mjs missing)" : false);

  it("starts and lists all tools without a prepared ELK bundle", { skip: elkSkip }, async () => {
    const s = launch(undefined, freshHome());
    try {
      await s.init();
      s.send({ id: "l", method: "tools/list" });
      const names = (await s.reply("l")).result.tools.map((t: any) => t.name);
      assert.ok(names.includes("prepare_drawio_xml") && names.includes("list_pages"), names.join(","));
    } finally {
      s.child.kill("SIGTERM");
      await s.exited();
    }
  });

  it("answers an ELK request honestly when the bundle is not prepared, without downloading it", { skip: elkSkip }, async () => {
    const home = freshHome();
    const before = elkServer?.state.requests ?? 0;
    const s = launch(undefined, home);
    try {
      await s.init();
      const result = await s.call(30, "prepare_drawio_xml", { content: chain, postLayout: "elk" });
      assert.notEqual(result.isError, true, text(result));
      assert.equal(xmlProblem(result.content[0].text), null);
      assert.match(text(result), /ELK|layout/i, "no note that layout did not run");
      assert.equal(await elk.verifiedElkBundle(routingCacheFor(home)), null, "the launcher prepared the bundle by itself");
      assert.equal((elkServer?.state.requests ?? 0) - before, 0);
    } finally {
      s.child.kill("SIGTERM");
      await s.exited();
    }
  });
});
