// Small JSON-RPC-over-stdio client for real launcher / Tool Server processes, plus an XML
// well-formedness check, shared by process tests.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type Rpc = { id?: unknown; result?: any; error?: any };

const spawned = new Set<ChildProcessWithoutNullStreams>();

/** Force-kills every process this module spawned that is still running. Use in an after() hook. */
export function killAllSpawned(): number {
  let killed = 0;
  for (const child of spawned) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      killed += 1;
    }
  }
  spawned.clear();
  return killed;
}

export class McpProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly messages: Rpc[] = [];
  stderr = "";
  private buffer = "";
  private waiters: Array<() => void> = [];

  constructor(argv: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; command?: string } = {}) {
    this.child = spawn(options.command ?? process.execPath, argv, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    spawned.add(this.child);
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        try { this.messages.push(JSON.parse(line)); } catch { /* not JSON */ }
        this.waiters.splice(0).forEach((w) => w());
      }
    });
    this.child.stderr.on("data", (c) => (this.stderr += c));
    this.child.stdin.on("error", () => {});
  }

  send(message: object) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  async reply(id: unknown, timeout = 60_000): Promise<Rpc> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = this.messages.find((m) => m.id === id && ("result" in m || "error" in m));
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no reply for ${String(id)}; stderr=${this.stderr.slice(-400)}`);
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 200); });
    }
  }

  async call(id: unknown, name: string, args: object, timeout?: number) {
    this.send({ id, method: "tools/call", params: { name, arguments: args } });
    return (await this.reply(id, timeout)).result;
  }

  async init() {
    this.send({ id: "init", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "s1-test", version: "0" } } });
    const r = await this.reply("init");
    this.send({ method: "notifications/initialized" });
    return r;
  }

  exited(timeout = 10_000): Promise<{ code: number | null; signal: string | null } | null> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve({ code: this.child.exitCode, signal: this.child.signalCode });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      this.child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
  }
}

/** Returns null when the text is well-formed XML with one root element, else the reason. */
export function xmlProblem(text: string): string | null {
  const body = text.trim().replace(/^<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const stack: string[] = [];
  let roots = 0;
  const token = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let last = 0;
  for (let m = token.exec(body); m; m = token.exec(body)) {
    if (stack.length === 0 && body.slice(last, m.index).trim()) return `text outside the root near ${m.index}`;
    last = token.lastIndex;
    if (m[0] === "<") return `stray < at ${m.index}`;
    if (m[0].startsWith("&")) return `bare & at ${m.index}`;
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[3] ?? "")) return `bare & in attribute of <${m[2]}>`;
    if (m[1]) {
      if (stack.pop() !== m[2]) return `mismatched </${m[2]}>`;
    } else if (!m[4]) {
      if (stack.length === 0) roots += 1;
      stack.push(m[2]!);
    } else if (stack.length === 0) roots += 1;
  }
  if (stack.length) return `unclosed <${stack.at(-1)}>`;
  if (body.slice(last).trim()) return "text after the root";
  return roots === 1 ? null : `${roots} root elements`;
}

/** Vertex geometries by cell id, read from mxGraphModel XML. */
export function vertexPositions(xml: string): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const cell = /<mxCell\b([^>]*\bvertex="1"[^>]*)>([\s\S]*?)<\/mxCell>/g;
  for (let m = cell.exec(xml); m; m = cell.exec(xml)) {
    const id = /\bid="([^"]*)"/.exec(m[1]!)?.[1];
    const geo = /<mxGeometry\b([^>]*)/.exec(m[2]!)?.[1] ?? "";
    const num = (n: string) => Number(new RegExp(`\\b${n}="([-\\d.]+)"`).exec(geo)?.[1] ?? 0);
    if (id) out.set(id, { x: num("x"), y: num("y") });
  }
  return out;
}
