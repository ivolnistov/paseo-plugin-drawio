// Starts the official draw.io Tool Server in the agent's workspace and relays its stdio.
// Usage: node drawio-toolserver.mjs <workspace-cwd> <tool-server-entry>
// The relay hides the tools that open diagrams in a browser at app.diagrams.net, refuses
// calls to them, and adds the Paseo surface contract as MCP server instructions. It also serves
// prepare_drawio_xml, which runs the official XML passes in a worker and returns the XML. Shape
// search reads an index shipped with the plugin, ELK layout reads a verified bundle prepared at
// install time, and the official edge-routing pass uses the routing library bundled in @drawio/mcp.
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { elkBundlePath, verifiedElkBundle } from "./elk-bundle.mjs";
import { PREPARE_CACHE_HOME, privateCacheDirectory } from "./user-cache.mjs";
import { buildPrepareTool, formatPrepareError, formatPrepareResult, PREPARE_TOOL_NAME, validatePrepareArguments } from "./prepare-xml.mjs";

export const SHAPE_INDEX_PATH = fileURLToPath(new URL("../assets/shape-search-index.json", import.meta.url));
const PREPARE_WORKER_PATH = fileURLToPath(new URL("./prepare-worker.mjs", import.meta.url));

export const PREPARE_TIMEOUT_MS = 30_000;
export { PREPARE_CACHE_HOME, privateCacheDirectory, userCacheHome } from "./user-cache.mjs";

/**
 * Serializes a prepare_drawio_xml reply as one protocol line. A reply over the relay's line limit
 * is replaced by a short error for the same request, so the client never gets a truncated line.
 */
export function encodePrepareReply(id, result, maxBytes = MAX_LINE_BYTES) {
  const line = `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
  if (Buffer.byteLength(line) <= maxBytes) return line;
  const refused = formatPrepareError(`the prepared XML is over the ${maxBytes}-byte message limit; nothing was returned.`);
  return `${JSON.stringify({ jsonrpc: "2.0", id, result: refused })}\n`;
}
export const PREPARE_MAX_QUEUED = 4;
const PREPARE_HEAP_MB = 512;

export const BLOCKED_TOOLS = Object.freeze(["open_drawio_xml", "open_drawio_csv", "open_drawio_mermaid"]);

const BLOCKED_MESSAGE =
  "This tool is disabled in Paseo because it opens the diagram in an external browser. " +
  "Save the diagram as a .drawio file and link it, or reply with a ```drawio fenced block.";

/**
 * Handles one client-to-server JSON-RPC message.
 * Returns { forward } with the message to pass on (or null) and { reply } to answer directly.
 */
export function transformClientMessage(message, pending) {
  if (Array.isArray(message)) {
    const results = message.map((entry) => transformClientMessage(entry, pending));
    const forward = results.map((result) => result.forward).filter((entry) => entry !== null);
    const replies = results.map((result) => result.reply).filter((entry) => entry !== null);
    return { forward: forward.length > 0 ? forward : null, reply: replies.length > 0 ? replies : null };
  }
  if (!message || typeof message !== "object") return { forward: message, reply: null };
  const hasId = message.id !== undefined && message.id !== null;
  if (!hasId && message.method === "tools/call" && BLOCKED_TOOLS.includes(message.params?.name)) {
    return { forward: null, reply: null };
  }
  if (hasId) {
    if (message.method === "initialize" || message.method === "tools/list") {
      pending.set(requestKey(message.id), message.method);
    }
    if (message.method === "tools/call" && BLOCKED_TOOLS.includes(message.params?.name)) {
      return {
        forward: null,
        reply: {
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: BLOCKED_MESSAGE }], isError: true },
        },
      };
    }
  }
  return { forward: message, reply: null };
}

/** Handles one server-to-client JSON-RPC message and returns the message to deliver. */
export function transformServerMessage(message, pending, instructions) {
  if (!message || typeof message !== "object" || message.id === undefined || message.id === null) return message;
  const key = requestKey(message.id);
  const method = pending.get(key);
  if (!method || (!("result" in message) && !("error" in message))) return message;
  pending.delete(key);
  if (!message.result || typeof message.result !== "object") return message;
  if (method === "tools/list" && Array.isArray(message.result.tools)) {
    const official = message.result.tools.find((tool) => tool?.name === "open_drawio_xml");
    const tools = message.result.tools.filter((tool) => !BLOCKED_TOOLS.includes(tool?.name) && tool?.name !== PREPARE_TOOL_NAME);
    return { ...message, result: { ...message.result, tools: [...tools, buildPrepareTool(official)] } };
  }
  if (method === "initialize" && instructions) {
    const existing = typeof message.result.instructions === "string" ? message.result.instructions.trim() : "";
    const merged = existing ? `${existing}\n\n${instructions}` : instructions;
    return { ...message, result: { ...message.result, instructions: merged } };
  }
  return message;
}

function requestKey(id) {
  return `${typeof id}:${String(id)}`;
}

/** Largest single message relayed, matching the MCP SDK stdio transport limit. */
export const MAX_LINE_BYTES = 10 * 1024 * 1024;

/**
 * Splits a text stream into newline-delimited JSON-RPC lines. Non-JSON lines pass through.
 * A line longer than `maxBytes` (UTF-8) is discarded up to its newline and reported through
 * `onOversize`; framing resumes with the next line.
 */
export function createLineRelay(onLine, { maxBytes = MAX_LINE_BYTES, onOversize = () => {} } = {}) {
  let buffer = "";
  let bufferBytes = 0;
  let discarding = false;
  let discarded = 0;

  const accept = (text) => {
    if (discarding) {
      discarded += Buffer.byteLength(text);
      return;
    }
    buffer += text;
    bufferBytes += Buffer.byteLength(text);
    if (bufferBytes > maxBytes) {
      discarding = true;
      discarded = bufferBytes;
      buffer = "";
      bufferBytes = 0;
    }
  };
  const endLine = () => {
    if (discarding) {
      discarding = false;
      onOversize(discarded);
      discarded = 0;
      return;
    }
    const line = buffer;
    buffer = "";
    bufferBytes = 0;
    onLine(line);
  };

  return {
    push(chunk) {
      let start = 0;
      let newline;
      while ((newline = chunk.indexOf("\n", start)) >= 0) {
        accept(chunk.slice(start, newline));
        endLine();
        start = newline + 1;
      }
      if (start < chunk.length) accept(chunk.slice(start));
    },
    flush() {
      if (discarding || buffer.length > 0) endLine();
    },
  };
}

function parse(line) {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/**
 * Runs prepare_drawio_xml calls one at a time in a fresh worker each, with a time and heap bound.
 * Calls beyond the queue limit are refused rather than buffered.
 */
export function createPrepareRunner({ sourceDir, cacheHome = PREPARE_CACHE_HOME, workerPath = PREPARE_WORKER_PATH, timeoutMs = PREPARE_TIMEOUT_MS, maxQueued = PREPARE_MAX_QUEUED }) {
  const queue = [];
  /** The job being started or run: { finish(result), worker }. */
  let running = null;
  let closed = false;
  let cacheDirectory = null;
  const closedError = () => formatPrepareError("the draw.io tool server is shutting down; nothing was run.");
  const interruptedError = () => formatPrepareError("the draw.io tool server is shutting down; the request did not finish.");

  const runNext = () => {
    if (closed || running || queue.length === 0) return;
    const job = queue.shift();
    let settled = false;
    let timer = null;
    const current = {
      worker: null,
      finish(result) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (current.worker) void current.worker.terminate();
        if (running === current) running = null;
        job.resolve(result);
        runNext();
      },
    };
    running = current;
    start(job, current, (handle) => (timer = handle)).catch((error) =>
      current.finish(formatPrepareError(`the draw.io passes could not start: ${error instanceof Error ? error.message : String(error)}`)),
    );
  };

  const start = async (job, current, setTimer) => {
    // ELK reads only a verified local bundle; without one the layout pass is skipped, never fetched.
    // Checked for every call: postLayout may also come from text after the XML.
    const elkPath = await verifiedElkBundle(cacheHome);
    // close() may have settled this call while the cache was being checked.
    if (closed || running !== current) return;
    const worker = new Worker(workerPath, {
      workerData: { sourceDir, ...job.args, elkReady: elkPath !== null },
      env: {
        ...process.env,
        DRAWIO_ELK_URL: elkPath ?? elkBundlePath(cacheHome),
        XDG_CACHE_HOME: (cacheDirectory ??= privateCacheDirectory(cacheHome)),
      },
      resourceLimits: { maxOldGenerationSizeMb: PREPARE_HEAP_MB },
      stdout: true,
    });
    current.worker = worker;
    setTimer(
      setTimeout(
        () => current.finish(formatPrepareError(`the draw.io passes did not finish within ${timeoutMs / 1000} seconds.`)),
        timeoutMs,
      ),
    );
    worker.on("message", (message) => {
      current.finish(message?.error ? formatPrepareError(`the draw.io passes failed: ${message.error}`) : formatPrepareResult(message));
    });
    worker.on("error", (error) => current.finish(formatPrepareError(`the draw.io passes failed: ${error.message}`)));
    worker.on("exit", (code) => current.finish(formatPrepareError(`the draw.io passes stopped (exit ${code}).`)));
  };

  return {
    run(rawArgs) {
      if (closed) return Promise.resolve(closedError());
      const checked = validatePrepareArguments(rawArgs);
      if (!checked.ok) return Promise.resolve(formatPrepareError(checked.error));
      if (queue.length >= maxQueued) {
        return Promise.resolve(formatPrepareError("too many prepare_drawio_xml calls are waiting; retry when one has finished."));
      }
      return new Promise((resolve) => {
        queue.push({ args: checked.value, resolve });
        runNext();
      });
    },
    /** Stops the runner: settles the running and queued calls with an error and starts nothing more. */
    async close() {
      closed = true;
      for (const job of queue.splice(0)) job.resolve(closedError());
      const current = running;
      if (!current) return;
      const worker = current.worker;
      current.finish(worker ? interruptedError() : closedError());
      if (worker) await worker.terminate().catch(() => {});
    },
  };
}

function fail(message) {
  process.stderr.write(`drawio-toolserver: ${message}\n`);
  process.exit(1);
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const [cwd, serverEntry] = argv;
  if (!cwd || !serverEntry) {
    process.stderr.write("drawio-toolserver: expected <workspace-cwd> <tool-server-entry>\n");
    process.exit(2);
  }
  try {
    process.chdir(cwd);
  } catch (error) {
    fail(`cannot use workspace ${cwd}: ${error.code ?? error.message}`);
  }
  if (!existsSync(serverEntry)) fail(`Tool Server entry not found: ${serverEntry}`);
  // Without the shipped shape index the Tool Server would download it; refuse to start instead.
  if (!existsSync(SHAPE_INDEX_PATH)) fail(`shipped asset missing: ${SHAPE_INDEX_PATH}`);
  const instructions = env.PASEO_DRAWIO_INSTRUCTIONS ?? "";
  const childEnv = { ...env };
  delete childEnv.PASEO_DRAWIO_INSTRUCTIONS;
  childEnv.DRAWIO_SHAPE_INDEX_URL = SHAPE_INDEX_PATH;
  // A local path is never downloaded by the official code; it is missing until ELK is prepared.
  childEnv.DRAWIO_ELK_URL = elkBundlePath(PREPARE_CACHE_HOME);
  const child = spawn(process.execPath, [serverEntry], { cwd, env: childEnv, stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  const prepareRunner = createPrepareRunner({ sourceDir: path.dirname(realpathSync(serverEntry)) });

  // The Tool Server may stop reading before it exits; later writes are dropped, not fatal.
  let childInputOpen = true;
  child.stdin.on("error", (error) => {
    if (!childInputOpen) return;
    childInputOpen = false;
    process.stderr.write(`drawio-toolserver: Tool Server stopped reading its input (${error.code ?? error.message})\n`);
  });
  const toChild = (text) => {
    if (childInputOpen && child.stdin.writable) child.stdin.write(text);
  };

  // A client that went away cannot receive anything more; stop relaying to it.
  let clientOutputOpen = true;
  process.stdout.on("error", () => {
    clientOutputOpen = false;
  });
  const toClient = (text) => {
    if (clientOutputOpen) process.stdout.write(text);
  };

  /** Exits once everything already written to the client has been flushed. */
  let exiting = false;
  const exitAfterFlush = (code) => {
    if (exiting) return;
    exiting = true;
    void prepareRunner.close();
    if (!clientOutputOpen || process.stdout.destroyed) process.exit(code);
    process.stdout.write("", () => process.exit(code));
    setTimeout(() => process.exit(code), 10_000).unref();
  };

  const oversize = (direction) => (bytes) =>
    process.stderr.write(`drawio-toolserver: dropped a ${bytes}-byte ${direction} message over the ${MAX_LINE_BYTES}-byte limit\n`);
  const fromClient = createLineRelay((line) => {
    const parsed = parse(line);
    if (!parsed.ok) {
      toChild(`${line}\n`);
      return;
    }
    const message = parsed.value;
    if (message && typeof message === "object" && message.method === "tools/call" && message.params?.name === PREPARE_TOOL_NAME) {
      if (message.id === undefined || message.id === null) return;
      void prepareRunner.run(message.params.arguments).then((result) => toClient(encodePrepareReply(message.id, result)));
      return;
    }
    const { forward, reply } = transformClientMessage(message, pending);
    if (reply) toClient(`${JSON.stringify(reply)}\n`);
    if (forward) toChild(`${JSON.stringify(forward)}\n`);
  }, { onOversize: oversize("client") });
  const fromServer = createLineRelay((line) => {
    const parsed = parse(line);
    if (!parsed.ok) {
      toClient(`${line}\n`);
      return;
    }
    toClient(`${JSON.stringify(transformServerMessage(parsed.value, pending, instructions))}\n`);
  }, { onOversize: oversize("server") });

  process.stdin.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  process.stdin.on("data", (chunk) => fromClient.push(chunk));
  process.stdin.on("end", () => {
    fromClient.flush();
    if (childInputOpen) child.stdin.end();
  });
  child.stdout.on("data", (chunk) => fromServer.push(chunk));
  child.stdout.on("end", () => fromServer.flush());
  child.on("error", (error) => {
    process.stderr.write(`drawio-toolserver: ${error.message}\n`);
    process.exit(1);
  });
  // "close" fires after the child's stdio is drained; the launcher then flushes its own stdout.
  child.on("close", (code, signal) => exitAfterFlush(code ?? (signal ? 1 : 0)));
  for (const name of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(name, () => child.kill(name));
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
