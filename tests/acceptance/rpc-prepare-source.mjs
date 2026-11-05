// Calls the plugin RPC drawio.prepare-source over the real authenticated daemon WebSocket with
// the public Paseo client SDK, and checks the contract on fixture sources.
// usage: PASEO_CLIENT_MODULE=<path to @getpaseo/client dist/index.js> \
//   node rpc-prepare-source.mjs <host:port> <passwordFile> <fixturesDir>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [endpoint, passwordFile, dir] = process.argv.slice(2);
const { DaemonClient } = await import(pathToFileURL(process.env.PASEO_CLIENT_MODULE).href);
const password = fs.readFileSync(passwordFile, "utf8").trim();
const connect = async (pw) => {
  const client = new DaemonClient({ url: `ws://${endpoint}/ws`, clientId: `s1-rpc-${process.pid}`, clientType: "cli", appVersion: "0.15.0", password: pw, reconnect: { enabled: false } });
  await client.connect();
  return client;
};
const results = { auth: {}, cases: {}, failures: [] };
for (const [label, pw] of [["none", undefined], ["wrong", "wrong-password"]]) {
  try { const c = await connect(pw); results.auth[label] = "CONNECTED"; await c.close(); results.failures.push(`auth:${label}`); }
  catch (e) { results.auth[label] = `rejected: ${String(e.message).slice(0, 60)}`; }
}
const client = await connect(password);
const rpc = (xml) => client.invokePluginRpc("drawio", "drawio.prepare-source", { xml });
const read = (n) => fs.readFileSync(path.join(dir, n), "utf8");
const expect = {
  "dtd-nested.drawio": (r) => r.status === "ok" && !/<!DOCTYPE|<!ENTITY|&(org|team|sys);/.test(r.xml) && r.xml.includes("FX-DTD ACME Platform API") && r.xml.includes('name="ACME page"') && /^<mxfile/.test(r.xml),
  "dtd-external.drawio": (r) => r.status === "error" && r.code === "external-entity",
  "dtd-quadratic.drawio": (r) => r.status === "error" && r.code === "too-large",
  "dtd-exponential.drawio": (r) => r.status === "error" && r.code === "too-large",
  "dtd-malformed.drawio": (r) => r.status === "error" && r.code === "invalid-xml",
  "plain.drawio": (r) => r.status === "ok" && r.xml === read("plain.drawio"),
};
for (const [name, ok] of Object.entries(expect)) {
  const t0 = Date.now();
  let r;
  try { r = await rpc(read(name)); } catch (e) { r = { threw: String(e.message).slice(0, 120) }; }
  results.cases[name] = { ms: Date.now() - t0, status: r.status, code: r.code, message: r.message?.slice(0, 90), xmlChars: r.xml?.length, sample: r.xml?.slice(0, 160), threw: r.threw };
  if (!ok(r)) results.failures.push(name);
}
// Over-limit input is refused by the RPC contract itself.
try { const r = await rpc("x".repeat(2_000_001)); results.cases.oversizedInput = { status: r.status, code: r.code }; results.failures.push("oversizedInput accepted"); }
catch (e) { results.cases.oversizedInput = { rejected: String(e.message).slice(0, 100) }; }
// Saturation: 2 running + 16 waiting; further concurrent calls must be refused as unavailable.
const burst = await Promise.all(Array.from({ length: 24 }, () => rpc(read("dtd-exponential.drawio")).catch((e) => ({ threw: e.message }))));
const tally = {};
for (const r of burst) { const k = r.threw ? "threw" : `${r.status}:${r.code}`; tally[k] = (tally[k] ?? 0) + 1; }
results.cases.burst24 = tally;
if (!tally["error:unavailable"]) results.failures.push("burst: no unavailable refusal");
const after = await rpc(read("dtd-nested.drawio"));
results.cases.afterBurst = { status: after.status };
if (after.status !== "ok") results.failures.push("afterBurst");
await client.close();
console.log(JSON.stringify(results, null, 1));
if (results.failures.length) process.exitCode = 1;
