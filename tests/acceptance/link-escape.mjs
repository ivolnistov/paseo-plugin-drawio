// Checks whether diagram links can navigate the sandboxed viewer frame away from about:srcdoc.
// Builds the production frame document (real viewer) for a fixture with a UserObject link
// (linkTarget _self) and an HTML-label anchor, opens it in the task Chrome (all DNS except
// loopback blocked, so nothing leaves the machine), clicks each link with real mouse input
// and reports the frame URL afterwards.
// usage: node --experimental-transform-types --import ./tests/support/register.mjs tests/acceptance/link-escape.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import { buildFrameHtml } from "../../client/web.ts";

const out = path.resolve(process.argv[2]);
const viewer = fs.readFileSync(new URL("../../server/assets/viewer-static.min.js.txt", import.meta.url), "utf8");
const cases = {
  userobject: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><UserObject label="LINK-SELF" link="https://egress-probe.invalid/userobject" linkTarget="_self" id="u"><mxCell style="rounded=0;fillColor=#ffcc00;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="200" height="80" as="geometry"/></mxCell></UserObject></root></mxGraphModel>`,
  anchor: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="h" value="&lt;a href=&quot;https://egress-probe.invalid/anchor&quot;&gt;ANCHOR-LINK&lt;/a&gt;" style="html=1;rounded=0;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="200" height="80" as="geometry"/></mxCell></root></mxGraphModel>`,
};
const port = process.env.CDP_PORT ?? "9555";
// Negative controls: the run must fail when the label cannot be found or the viewer never renders.
const control = process.env.S1_LINK_CONTROL ?? "";
if (control === "missing-label") for (const k of Object.keys(cases)) cases[k] = cases[k].replace(/LINK-SELF|ANCHOR-LINK/g, "OTHER-TEXT");
if (control === "not-rendered") for (const k of Object.keys(cases)) cases[k] = cases[k].replace("</root>", "</rot>");
const results = {};
for (const [name, xml] of Object.entries(cases)) {
  const srcdoc = buildFrameHtml({ viewerSource: viewer, xml, nonce: "n", dark: false, background: "#ffffff", foreground: "#000000", fill: true });
  const page = path.join(out, `link-escape-${name}.html`);
  fs.writeFileSync(page, `<!doctype html><body style="margin:0"><iframe id=f sandbox="allow-scripts" style="border:0;width:600px;height:300px"></iframe><script>document.getElementById("f").srcdoc=${JSON.stringify(srcdoc).replace(/</g, "\\u003c")};</script>`);
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?file://${page}`, { method: "PUT" })).json();
  await new Promise((r) => setTimeout(r, 6000));
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const frameUrl = async () => (await send("Target.getTargets")).result.targetInfos.filter((t) => t.type === "iframe" && t.openerId === undefined).map((t) => t.url);
  const label = name === "anchor" ? "ANCHOR-LINK" : "LINK-SELF";
  let target = (await send("Target.getTargets")).result.targetInfos.find((t) => t.type === "iframe" && t.parentId === tab.id) ?? (await send("Target.getTargets")).result.targetInfos.find((t) => t.type === "iframe" && t.url === "about:srcdoc");
  const att = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sid = att.result.sessionId;
  const rect = (await send("Runtime.evaluate", { expression: `(() => { const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())) if(n.textContent.includes(${JSON.stringify(label)})) { const r=(n.parentElement).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; } return null; })()`, returnByValue: true }, sid)).result.result.value;
  const before = (await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, sid)).result.result.value;
  const rendered = (await send("Runtime.evaluate", { expression: "document.querySelectorAll('.mxgraph svg').length", returnByValue: true }, sid)).result.result.value;
  let clicks = 0;
  if (rect) for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 }); clicks += 1; }
  await new Promise((r) => setTimeout(r, 3000));
  const after = (await send("Target.getTargets")).result.targetInfos.filter((t) => t.type === "iframe" || (t.type === "page" && t.url.includes("egress-probe"))).map((t) => `${t.type}:${t.url}`);
  results[name] = { labelFound: !!rect, rendered, clicks, before, after };
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
}
console.log(JSON.stringify(results, null, 1));
const unexercised = Object.entries(results).filter(([, r]) => !r.labelFound || !(r.rendered > 0) || r.clicks !== 3);
if (unexercised.length) { console.error(`link not exercised (label, viewer or click missing): ${unexercised.map(([n]) => n).join(", ")}`); process.exitCode = 1; }
const escaped = Object.entries(results).filter(([, r]) => r.after.some((u) => u.includes("egress-probe")));
if (escaped.length) { console.error(`frame navigated off about:srcdoc: ${escaped.map(([n]) => n).join(", ")}`); process.exitCode = 1; }
