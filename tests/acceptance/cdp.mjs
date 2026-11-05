// Minimal CDP driver for the task-owned acceptance Chrome.
// usage: CDP_PORT=9555 node cdp.mjs <cmd> [arg] [ms]
//   nav <url> | eval <js> | shot <file> | typefile <file> | press <Key> | click <x,y>
//   feval <js>      evaluate in every child frame (isolated world), returns [{url, value}]
//   watch <js> <ms> evaluate <js>, then record console/log/network events for <ms>
import fs from "node:fs";
const port = process.env.CDP_PORT ?? "9555";
const [cmd, arg, ms] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method) events.push(m);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const evaluate = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
  return r.result?.exceptionDetails ? { exception: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result?.result?.value;
};
let out;
if (cmd === "nav") out = await send("Page.navigate", { url: arg });
else if (cmd === "eval") out = await evaluate(arg);
else if (cmd === "shot") { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(arg, Buffer.from(r.result.data, "base64")); out = arg; }
else if (cmd === "typefile") { await send("Input.insertText", { text: fs.readFileSync(arg, "utf8").trim() }); out = "typed from file"; }
else if (cmd === "press") { await send("Input.dispatchKeyEvent", { type: "keyDown", key: arg, code: arg, windowsVirtualKeyCode: arg === "Enter" ? 13 : 0 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: arg, code: arg }); out = "pressed"; }
else if (cmd === "click") { const [x, y] = arg.split(",").map(Number); for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); out = "clicked"; }
else if (cmd === "feval") {
  const tree = (await send("Page.getFrameTree")).result.frameTree;
  const frames = [];
  const walk = (n) => { for (const c of n.childFrames ?? []) { frames.push(c.frame); walk(c); } };
  walk(tree);
  out = [];
  for (const f of frames) {
    const w = await send("Page.createIsolatedWorld", { frameId: f.id, worldName: "s1probe" });
    out.push({ url: f.url.slice(0, 40), value: await evaluate(arg, w.result?.executionContextId) });
  }
  // Sandboxed srcdoc frames may run out of process; reach them as iframe targets.
  const { result } = await send("Target.getTargets");
  for (const t of result.targetInfos.filter((t) => t.type === "iframe")) {
    const att = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    const sid = att.result?.sessionId;
    if (!sid) continue;
    const r = await send("Runtime.evaluate", { expression: arg, returnByValue: true, awaitPromise: true }, sid);
    out.push({ target: t.url.slice(0, 30), value: r.result?.result?.value ?? r.result?.exceptionDetails?.text });
    await send("Target.detachFromTarget", { sessionId: sid });
  }
} else if (cmd === "watch") {
  await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  const value = await evaluate(arg);
  await new Promise((r) => setTimeout(r, Number(ms ?? 3000)));
  const ws = events.filter((e) => /webSocketFrame(Sent|Received)/.test(e.method));
  const rpc = ws.filter((e) => (e.params.response?.payloadData ?? "").includes("viewer-asset"));
  const prepare = ws.filter((e) => e.method.endsWith("Sent") && (e.params.response?.payloadData ?? "").includes("drawio.prepare-source"));
  out = { value, wsFrames: ws.length, prepareSourceRequests: prepare.length, prepareSourceHasDoctype: prepare.map((e) => /DOCTYPE/.test(e.params.response.payloadData)), viewerAssetFrames: rpc.map((e) => ({ m: e.method.replace("Network.webSocketFrame", ""), bytes: (e.params.response?.payloadData ?? "").length })), events: events.filter((e) => /consoleAPICalled|entryAdded|requestWillBeSent|loadingFailed|exceptionThrown/.test(e.method)).map((e) => ({
    m: e.method, url: e.params.request?.url?.slice(0, 160), type: e.params.type, text: (e.params.entry?.text ?? e.params.args?.map((a) => a.value ?? a.description).join(" ") ?? e.params.errorText ?? e.params.exceptionDetails?.text)?.slice?.(0, 240), blocked: e.params.blockedReason }) ) };
}
console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
ws.close();
