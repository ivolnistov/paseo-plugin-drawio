// Runs the installed launcher + Tool Server and calls search_shapes once. Meant to run under
// sandbox-exec with outbound network denied, with an empty XDG cache to detect downloads.
// usage: node shape-search-offline.mjs <plugin-root> <workspace>
import { spawn } from "node:child_process";
import path from "node:path";
const [root, ws] = process.argv.slice(2);
const launcher = path.join(root, "server/launcher/drawio-toolserver.mjs");
const entry = path.join(root, "node_modules/@drawio/mcp/src/index.js");
const env = { ...process.env, DRAWIO_ICON_SERVICE_URL: "off", DRAWIO_BASE_URL: "http://127.0.0.1:9/", PASEO_DRAWIO_INSTRUCTIONS: "x" };
const child = spawn(process.execPath, [launcher, ws, entry], { env, stdio: ["pipe", "pipe", "pipe"] });
let buf = "", err = "";
const replies = new Map();
child.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id != null) replies.set(m.id, m); } catch {} } });
child.stderr.on("data", (c) => (err += c));
const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const wait = async (id, ms = 30000) => { const end = Date.now() + ms; while (!replies.has(id) && Date.now() < end) await new Promise((r) => setTimeout(r, 100)); return replies.get(id); };
send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "s1", version: "0" } } });
await wait(1);
send({ method: "notifications/initialized" });
const t0 = Date.now();
send({ id: 2, method: "tools/call", params: { name: "search_shapes", arguments: { query: "aws lambda", limit: 3 } } });
const r = await wait(2);
const text = r?.result?.content?.[0]?.text ?? JSON.stringify(r?.error ?? null);
console.log(JSON.stringify({ ms: Date.now() - t0, isError: r?.result?.isError ?? null, preview: text.slice(0, 300), stderrTail: err.slice(-300) }));
child.kill("SIGTERM");
let found = 0;
try { found = JSON.parse(text).length; } catch { found = 0; }
if (!r || r.error || r.result?.isError || found === 0) process.exitCode = 1;
