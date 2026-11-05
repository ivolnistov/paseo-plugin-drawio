// Bounded measurement of internal-entity expansion cost in the browser's XML parser (the parser
// the viewer frame uses). One 100,000-character entity is referenced 10, 100 and 1,000 times
// (1 MB, 10 MB, 100 MB expanded) from documents under 2,000,000 characters; the script records
// parse time, whether the parser refused, and the expanded text length. Needs a task Chrome on
// CDP port 9659. It deliberately avoids nested (exponential) entities.
// usage: node dtd-parse-cost.mjs
const port = 9659;
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const send = (method, params) => new Promise((res) => { const i = ++id; ws.addEventListener("message", function h(e) { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener("message", h); res(m); } }); ws.send(JSON.stringify({ id: i, method, params })); });
const out = [];
for (const refs of [10, 100, 1000]) {
  const expr = `(() => { const ent = "A".repeat(100000); const doc = '<!DOCTYPE mxfile [<!ENTITY e "' + ent + '">]><mxfile><diagram id="d">' + "&e;".repeat(${refs}) + '</diagram></mxfile>';
    const t0 = performance.now(); const parsed = new DOMParser().parseFromString(doc, "text/xml"); const ms = Math.round(performance.now() - t0);
    const err = parsed.getElementsByTagName("parsererror")[0]; const d = parsed.getElementsByTagName("diagram")[0];
    return { refs: ${refs}, sourceChars: doc.length, ms, refused: !!err, error: err ? err.textContent.slice(0, 120) : null, expandedChars: d ? d.textContent.length : 0 }; })()`;
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, timeout: 60000 });
  out.push(r.result?.result?.value ?? r.result);
}
console.log(JSON.stringify(out, null, 1));
ws.close();
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
