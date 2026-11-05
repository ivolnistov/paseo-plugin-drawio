// Synthetic ACP provider for acceptance runs. No inference. A prompt "reply:<name>" streams
// the file <workspace>/replies/<name>.md back as the assistant message in small chunks, so
// timeline transformers see real streaming revisions. It records the MCP servers it receives.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const LOG = process.env.S1_ACP_LOG;
const log = (o) => LOG && fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...o }) + "\n");
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const sessions = new Map();

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  try {
    if (m.method === "initialize") {
      return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: {}, mcpCapabilities: { http: false, sse: false } }, authMethods: [], agentInfo: { name: "s1-fixture-acp", version: "0" } } });
    }
    if (m.method === "session/new") {
      const sessionId = `s1-${Date.now()}`;
      sessions.set(sessionId, m.params.cwd);
      log({ ev: "session-new", cwd: m.params.cwd, mcpServerNames: (m.params.mcpServers ?? []).map((s) => s.name) });
      return send({ id: m.id, result: { sessionId } });
    }
    if (m.method === "session/prompt") {
      const { sessionId, prompt } = m.params;
      const text = (prompt ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const name = /reply:([\w-]+)/.exec(text)?.[1];
      const file = name ? path.join(sessions.get(sessionId) ?? ".", "replies", `${name}.md`) : null;
      const reply = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `No reply fixture for: ${text.slice(0, 80)}`;
      const chunk = Number(process.env.S1_ACP_CHUNK ?? 120);
      // A line "<<<SPLIT>>>" ends one assistant message: a completed tool call separates the next.
      const parts = reply.split("\n<<<SPLIT>>>\n");
      for (const [n, part] of parts.entries()) {
        if (n > 0) {
          send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId: `split-${n}`, title: `fixture separator ${n}`, kind: "other", status: "completed" } } });
        }
        for (let i = 0; i < part.length; i += chunk) {
          send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: part.slice(i, i + chunk) } } } });
          await new Promise((r) => setTimeout(r, Number(process.env.S1_ACP_DELAY_MS ?? 15)));
        }
      }
      log({ ev: "replied", name: name ?? null, chars: reply.length });
      return send({ id: m.id, result: { stopReason: "end_turn" } });
    }
    if (m.method === "session/cancel") return;
    if (m.id != null) send({ id: m.id, result: {} });
  } catch (e) {
    if (m.id != null) send({ id: m.id, error: { code: -32603, message: String(e?.message ?? e) } });
  }
});
