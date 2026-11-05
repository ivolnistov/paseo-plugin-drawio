// Runs the production viewer frame (buildFrameHtml with the pinned viewer) on every page
// encoding from expansion-variants.mjs in a task-owned headless Chrome on CDP port 9658
// (all DNS blocked). Small variants must render; over-limit variants must fail with the
// size notice and never create a viewer element. With --negative-control, the expansion check
// is disabled in a throwaway copy of the frame HTML, and over-limit pages must then render,
// which shows this check can detect a missing guard.
// usage: node --experimental-transform-types --import ./tests/support/register.mjs \
//   tests/acceptance/frame-expansion.mjs <variantsDir> [--negative-control name,...]
import fs from "node:fs";
import path from "node:path";
import { buildFrameHtml } from "../../client/web.ts";

const dir = path.resolve(process.argv[2]);
const negIndex = process.argv.indexOf("--negative-control");
const negative = negIndex > 0 ? process.argv[negIndex + 1].split(",") : null;
const namesFile = path.join(dir, "names.txt");
const names = negative ?? (fs.existsSync(namesFile)
  ? fs.readFileSync(namesFile, "utf8").trim().split(" ")
  : fs.readdirSync(dir).filter((f) => f.endsWith(".drawio")).map((f) => f.slice(0, -".drawio".length)).sort());
const viewer = fs.readFileSync(new URL("../../server/assets/viewer-static.min.js.txt", import.meta.url), "utf8");
const GUARD = "if(expandedSize(doc,C.maxExpandedBytes)>C.maxExpandedBytes)";
const port = 9658;
const results = {};
for (const name of names) {
  const xml = fs.readFileSync(path.join(dir, `${name}.drawio`), "utf8");
  let html = buildFrameHtml({ viewerSource: viewer, xml, nonce: "s1", dark: false, background: "#ffffff", foreground: "#000000", fill: true });
  if (negative) {
    if (!html.includes(GUARD)) throw new Error("guard text not found in frame HTML");
    html = html.replace(GUARD, "if(false)");
  }
  const page = path.join(dir, "frame-page.html");
  fs.writeFileSync(page, `<!doctype html><body><iframe id=f sandbox="allow-scripts" style="width:800px;height:600px;border:0"></iframe><script>window.R=[];addEventListener("message",e=>{if(e.data&&e.data.nonce==="s1"&&e.data.type!=="size")R.push(e.data)});document.getElementById("f").srcdoc=${JSON.stringify(html).replace(/</g, "\\u003c")};</script>`);
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?file://${page}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  let events = [];
  for (let t = 0; t < 40 && events.length === 0; t++) {
    await new Promise((r) => setTimeout(r, 500));
    events = (await send("Runtime.evaluate", { expression: "window.R", returnByValue: true })).result?.result?.value ?? [];
  }
  const frame = (await send("Target.getTargets")).result.targetInfos.find((t) => t.type === "iframe");
  let dom = null;
  if (frame) {
    const sid = (await send("Target.attachToTarget", { targetId: frame.targetId, flatten: true })).result?.sessionId;
    dom = (await send("Runtime.evaluate", { returnByValue: true, expression: "({ viewerElements: document.querySelectorAll('.mxgraph').length, svg: document.querySelectorAll('svg').length, error: (document.querySelector('.drawio-error')||{}).textContent||null })" }, sid)).result?.result?.value;
  }
  results[name] = { events: events.map((e) => e.type + (e.detail?.message ? `: ${e.detail.message.slice(0, 70)}` : e.detail?.pages ? `: ${e.detail.pages} page(s)` : "")), ...dom };
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
}
fs.rmSync(path.join(dir, "frame-page.html"), { force: true });
const failures = [];
for (const [name, r] of Object.entries(results)) {
  const rendered = r.events.some((e) => e.startsWith("rendered")) && r.viewerElements > 0;
  const notice = name.includes("malformed") ? /could not be parsed/ : /too large/;
  const refused = r.events.some((e) => notice.test(e)) && r.viewerElements === 0;
  const expectRender = negative ? true : name.startsWith("small-") && !name.includes("malformed");
  if (expectRender ? !rendered : !refused) failures.push(name);
}
console.log(JSON.stringify({ mode: negative ? "negative-control" : "production", results, failures }, null, 1));
if (failures.length) process.exitCode = 1;
