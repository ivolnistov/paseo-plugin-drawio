// Prepares diagram sources that carry a DOCTYPE, so the browser never parses a DTD.
// Sources without one are returned unchanged. Sources with one are parsed by libxml2 (WASM) in a
// worker thread with internal entities expanded under libxml2's amplification limit, external
// loading disabled, and the DTD removed from the canonical XML that is returned.
import { Worker } from "node:worker_threads";

export const MAX_SOURCE_CHARS = 2_000_000;
export const PREPARE_SOURCE_TIMEOUT_MS = 10_000;
const MAX_RUNNING = 2;
const MAX_WAITING = 16;

const DOCTYPE = "<!DOCTYPE";

const error = (code, message) => ({ status: "error", code, message });

/** Offset of the DOCTYPE declaration when it follows only a prolog, else -1. */
function prologDoctype(xml) {
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < xml.length && /\s/.test(xml[i])) i += 1;
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end < 0) return -1;
      i = end + 2;
    } else if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) return -1;
      i = end + 3;
    } else {
      return xml.startsWith(DOCTYPE, i) ? i : -1;
    }
  }
}

/**
 * Finds what libxml2 would otherwise accept or skip silently: an external identifier (SYSTEM or
 * PUBLIC right after the declared name of the DOCTYPE, an ENTITY or a NOTATION) and any parameter
 * entity. Only the DOCTYPE is scanned, one declaration at a time; quoted literals, comments and
 * processing instructions are skipped, and nothing is expanded.
 */
export function findExternalReference(xml, start) {
  let i = start + DOCTYPE.length;
  const skipSpace = () => {
    while (i < xml.length && /\s/.test(xml[i])) i += 1;
  };
  const readName = () => {
    const from = i;
    while (i < xml.length && !/[\s"'<>[\]%]/.test(xml[i])) i += 1;
    return xml.slice(from, i);
  };
  const externalKeyword = () => /^(SYSTEM|PUBLIC)(?=[\s"'>])/.test(xml.slice(i, i + 7));
  /** Skips to the end of the current declaration; reports a parameter entity reference in it. */
  const skipDeclaration = () => {
    while (i < xml.length) {
      const ch = xml[i];
      if (ch === '"' || ch === "'") {
        const close = xml.indexOf(ch, i + 1);
        if (close < 0) return "end";
        i = close + 1;
      } else if (ch === "%") {
        return "parameter";
      } else if (ch === ">") {
        i += 1;
        return "done";
      } else {
        i += 1;
      }
    }
    return "end";
  };

  skipSpace();
  readName();
  skipSpace();
  if (externalKeyword()) return "an external DTD";
  while (i < xml.length && xml[i] !== "[" && xml[i] !== ">") i += 1;
  if (xml[i] !== "[") return null;
  i += 1;

  while (i < xml.length) {
    skipSpace();
    if (xml[i] === "]" || i >= xml.length) return null;
    if (xml[i] === "%") return "a parameter entity";
    if (xml.startsWith("<!--", i)) {
      const close = xml.indexOf("-->", i + 4);
      if (close < 0) return null;
      i = close + 3;
      continue;
    }
    if (xml.startsWith("<?", i)) {
      const close = xml.indexOf("?>", i + 2);
      if (close < 0) return null;
      i = close + 2;
      continue;
    }
    if (xml.startsWith("<!ENTITY", i) || xml.startsWith("<!NOTATION", i)) {
      const entity = xml.startsWith("<!ENTITY", i);
      i += entity ? 8 : 10;
      skipSpace();
      if (xml[i] === "%") return "a parameter entity";
      readName();
      skipSpace();
      if (externalKeyword()) return entity ? "an external entity" : "an external notation";
    } else if (xml[i] === "<") {
      i += 1;
    } else {
      // Not a declaration; libxml2 reports it as invalid.
      return null;
    }
    const outcome = skipDeclaration();
    if (outcome === "parameter") return "a parameter entity";
    if (outcome === "end") return null;
  }
  return null;
}

let running = 0;
const waiting = [];

function acquire() {
  if (running < MAX_RUNNING) {
    running += 1;
    return Promise.resolve();
  }
  if (waiting.length >= MAX_WAITING) return null;
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

function parseInWorker(xml, timeoutMs) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./xml-source-worker.mjs", import.meta.url), { workerData: { xml, maxOutputChars: MAX_SOURCE_CHARS } });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish(error("unavailable", `Preparing the diagram took longer than ${timeoutMs / 1000} seconds.`)), timeoutMs);
    worker.once("message", (result) => finish(result));
    worker.once("error", (cause) => finish(error("unavailable", `The XML parser failed: ${cause.message}`)));
    worker.once("exit", (code) => finish(error("unavailable", `The XML parser stopped (exit ${code}).`)));
  });
}

/**
 * Resolves to { status: "ok", xml } or { status: "error", code, message }, where code is
 * "too-large", "external-entity", "invalid-xml", or "unavailable" when the parser cannot run.
 */
export async function prepareDiagramXml(xml, { timeoutMs = PREPARE_SOURCE_TIMEOUT_MS } = {}) {
  if (typeof xml !== "string") return error("invalid-xml", "The diagram source is not text.");
  if (xml.length > MAX_SOURCE_CHARS) {
    return error("too-large", `The diagram source has ${xml.length} characters; the limit is ${MAX_SOURCE_CHARS}.`);
  }
  if (!xml.includes(DOCTYPE)) return { status: "ok", xml };

  const start = prologDoctype(xml);
  if (start >= 0) {
    const external = findExternalReference(xml, start);
    if (external) return error("external-entity", `The diagram uses ${external}, which is never loaded.`);
  }

  const slot = acquire();
  if (!slot) return error("unavailable", "Too many diagrams are being prepared; try again shortly.");
  await slot;
  try {
    return await parseInWorker(xml, timeoutMs);
  } finally {
    release();
  }
}
