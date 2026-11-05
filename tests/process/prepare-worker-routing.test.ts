import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { Worker } from "node:worker_threads";
import { xmlProblem } from "../support/mcp-process.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKER = path.join(ROOT, "server/launcher/prepare-worker.mjs");
const SOURCE_DIR = path.join(ROOT, "node_modules/@drawio/mcp/src");
const TRAP = path.join(ROOT, "tests/support/fetch-trap-worker.mjs");
const BUNDLED_ROUTING = readFileSync(path.join(SOURCE_DIR, "../vendor/libavoid/libavoid-routing.js"), "utf8");

// Valid enough for the official loader to accept and evaluate, but useless for routing: an edge
// can only be routed if this cached copy is ignored.
const SENTINEL =
  "globalThis.__drawioRoutingSentinel = true;" +
  "globalThis.AvoidRouting = { computeRoutes() { throw new Error('cached routing library used'); } };";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-route-worker-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** Every file under `dir` with its bytes, so any write, rename or removal shows as a difference. */
const contents = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => statSync(path.join(dir, f)).isFile())
      .sort()
      .map((f) => [f, readFileSync(path.join(dir, f), "base64")]),
  );

type Probe = { fetches: string[]; sentinelEvaluated: boolean };
type Reply = { xml?: string; notes?: string[]; error?: string; probe: Probe };

function runWorker(args: Record<string, unknown>, cacheHome: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(TRAP, {
      workerData: { workerUrl: pathToFileURL(WORKER).href, trapSource: BUNDLED_ROUTING, sourceDir: SOURCE_DIR, ...args },
      env: { ...process.env, XDG_CACHE_HOME: cacheHome },
      stdout: true,
      stderr: true,
    });
    const settle = (done: () => void) => {
      clearTimeout(timer);
      void worker.terminate();
      done();
    };
    const timer = setTimeout(() => settle(() => reject(new Error("prepare worker did not answer within 30 s"))), 30_000);
    worker.once("message", (message: Reply) => settle(() => resolve(message)));
    worker.once("error", (error) => settle(() => reject(error)));
    worker.once("exit", (code) => settle(() => reject(new Error(`prepare worker exited (code ${code}) without answering`))));
  });
}

const vertex = (id: string, x: number, y: number, w: number, h: number) =>
  `<mxCell id="${id}" value="${id}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
// B stands on the straight line from A to C.
const OBSTACLE = { x: 200, y: 60, w: 80, h: 120 };
const blocked =
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
  vertex("A", 0, 100, 80, 40) +
  vertex("B", OBSTACLE.x, OBSTACLE.y, OBSTACLE.w, OBSTACLE.h) +
  vertex("C", 420, 100, 80, 40) +
  `<mxCell id="e1" edge="1" parent="1" source="A" target="C"><mxGeometry relative="1" as="geometry"/></mxCell>` +
  `</root></mxGraphModel>`;

const edgePoints = (xml: string, id: string) => {
  const edge = new RegExp(`<mxCell\\b[^>]*id="${id}"[\\s\\S]*?</mxCell>`).exec(xml)?.[0] ?? "";
  const points = /<Array as="points">([\s\S]*?)<\/Array>/.exec(edge)?.[1] ?? "";
  return [...points.matchAll(/<mxPoint\b([^>]*)\/>/g)].map(([, attrs]) => ({
    x: Number(/\bx="([^"]*)"/.exec(attrs)?.[1] ?? 0),
    y: Number(/\by="([^"]*)"/.exec(attrs)?.[1] ?? 0),
  }));
};

type Point = { x: number; y: number };
/** Whether segment p-q passes through the open interior of the rectangle (Liang-Barsky clipping). */
function crossesInterior(p: Point, q: Point, r: typeof OBSTACLE): boolean {
  const [x0, y0, x1, y1] = [r.x + 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let lo = 0;
  let hi = 1;
  for (const [pk, qk] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const t = qk / pk;
    if (pk < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}

describe("prepare worker edge routing (real worker thread, official routing pass)", () => {
  it("routes around an obstacle from the bundled library: no fetch, no cache write, cached copy ignored", async () => {
    const cacheHome = path.join(scratch, "cache");
    mkdirSync(path.join(cacheHome, "drawio-mcp"), { recursive: true });
    writeFileSync(path.join(cacheHome, "drawio-mcp", "libavoid-routing.json"), JSON.stringify({ etag: '"old"', src: SENTINEL }));
    const cacheBefore = contents(cacheHome);

    const reply = await runWorker({ content: blocked, routing: "libavoid" }, cacheHome);

    assert.equal(reply.error, undefined, reply.error);
    assert.deepEqual(reply.probe.fetches, [], "the routing pass tried to fetch");
    assert.equal(reply.probe.sentinelEvaluated, false, "the previously cached routing library was evaluated");
    assert.deepEqual(contents(cacheHome), cacheBefore, "the routing cache changed");

    const xml = reply.xml!;
    assert.equal(xmlProblem(xml), null, `not well-formed: ${xmlProblem(xml)}`);
    assert.match(/<mxCell\b[^>]*id="e1"[^>]*>/.exec(xml)?.[0] ?? "", /libavoidRouting=1/, "edge not marked as routed");
    const waypoints = edgePoints(xml, "e1");
    assert.ok(waypoints.length > 0, "routed edge has no waypoints");
    // From A's centre through the waypoints to C's centre, the path must not cut through B.
    const route = [{ x: 40, y: 120 }, ...waypoints, { x: 460, y: 120 }];
    for (let i = 1; i < route.length; i++) {
      assert.ok(!crossesInterior(route[i - 1], route[i], OBSTACLE), `segment ${JSON.stringify([route[i - 1], route[i]])} crosses B`);
    }
    assert.ok(!(reply.notes ?? []).some((n) => /routing made no changes/i.test(n)), JSON.stringify(reply.notes));
  });
});
