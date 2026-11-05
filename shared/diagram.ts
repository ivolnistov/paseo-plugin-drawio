import { Inflate } from "pako";
import { MAX_DIAGRAM_CHARS, MAX_EXPANDED_BYTES } from "./constants";

export type DiagramCheck =
  | { status: "ok"; pages: number; compressed: boolean }
  | { status: "empty" }
  | { status: "too-large"; chars: number; limit: number; expanded?: true }
  | { status: "not-drawio" };

/**
 * Cheap structural gate before the official viewer parses the source. It decides whether the
 * text can be a draw.io document and bounds the expanded size of the pages it can read. It does
 * not expand DTD entities; the viewer frame repeats the expansion check on the browser's own
 * parse of the document before rendering, so this gate is a prefilter, not the final bound.
 */
export function classifyDiagramXml(
  xml: string,
  limit = MAX_DIAGRAM_CHARS,
  expandedLimit = MAX_EXPANDED_BYTES,
): DiagramCheck {
  const trimmed = xml.trim();
  if (trimmed.length === 0) return { status: "empty" };
  // The viewer receives the whole source, surrounding whitespace included.
  if (xml.length > limit) return { status: "too-large", chars: xml.length, limit };
  const body = stripProlog(trimmed);
  if (!/^<(mxfile|mxGraphModel)[\s>/]/i.test(body)) return { status: "not-drawio" };

  const pages = diagramBodies(body);
  let expanded = 0;
  let compressed = false;
  for (const page of pages) {
    const content = pageContent(page);
    if (content.kind === "empty") continue;
    // Uncompressed pages are bounded by the source limit; only inflated bytes count here.
    if (content.kind === "text") {
      compressed = true;
      const size = inflatedSize(content.text, expandedLimit - expanded);
      // Undecodable pages are left to the viewer, which reports its own error.
      if (size !== null) expanded += size;
    }
    if (expanded > expandedLimit) return { status: "too-large", chars: expanded, limit: expandedLimit, expanded: true };
  }
  return { status: "ok", pages: Math.max(1, pages.length), compressed };
}

/** True when the source declares a DOCTYPE; such sources are prepared on the daemon before viewing. */
export function hasDoctype(xml: string): boolean {
  return xml.includes("<!DOCTYPE");
}

export function countPages(xml: string): number {
  return Math.max(1, diagramBodies(xml).length);
}

/** Removes what XML allows before the root element: declaration, processing instructions, comments, doctype. */
function stripProlog(xml: string): string {
  const prolog = /^\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)/i;
  let rest = xml;
  for (let match = prolog.exec(rest); match; match = prolog.exec(rest)) rest = rest.slice(match[0].length);
  return rest.trimStart();
}

/**
 * The raw content of every <diagram> element, in document order. Comments and CDATA sections are
 * skipped as units, so text inside them never opens or closes a page. Self-closing pages are empty.
 */
function diagramBodies(xml: string): string[] {
  const bodies: string[] = [];
  const token = new RegExp(`<!--[\\s\\S]*?(?:-->|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)|<\\?[\\s\\S]*?(?:\\?>|$)|<diagram(?=[\\s>/])(${ATTRIBUTES})>|<\\/diagram\\s*>`, "gi");
  let bodyStart = -1;
  for (let match = token.exec(xml); match; match = token.exec(xml)) {
    const text = match[0];
    if (text.startsWith("<!") || text.startsWith("<?")) continue;
    if (text.startsWith("</")) {
      if (bodyStart >= 0) bodies.push(xml.slice(bodyStart, match.index));
      bodyStart = -1;
    } else if (bodyStart < 0) {
      if (match[1]!.trimEnd().endsWith("/")) bodies.push("");
      else bodyStart = token.lastIndex;
    }
  }
  if (bodyStart >= 0) bodies.push(xml.slice(bodyStart));
  return bodies;
}

/** The attribute part of a start tag; quoted values may contain ">". */
const ATTRIBUTES = `(?:[^>"']|"[^"]*"|'[^']*')*`;

type PageContent = { kind: "empty" } | { kind: "markup"; length: number } | { kind: "text"; text: string };

const PREDEFINED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes character and predefined entity references; other references are left as written. */
function decodeReferences(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (whole, dec, hex, name) => {
    if (name) return PREDEFINED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * What the viewer reads from one page: its trimmed text content (character data of the whole
 * subtree, with CDATA and references resolved) is the compressed payload when not empty;
 * otherwise an element child is an uncompressed model.
 */
function pageContent(body: string): PageContent {
  let text = "";
  let hasElement = false;
  const part = new RegExp(
    `<!--[\\s\\S]*?(?:-->|$)|<\\?[\\s\\S]*?(?:\\?>|$)|<!\\[CDATA\\[([\\s\\S]*?)(?:\\]\\]>|$)|<(/?)[A-Za-z_][^\\s/>]*${ATTRIBUTES}>|([^<]+)|<`,
    "g",
  );
  for (let match = part.exec(body); match; match = part.exec(body)) {
    if (match[1] !== undefined) text += match[1];
    else if (match[3] !== undefined) text += decodeReferences(match[3]);
    else if (match[2] === "") hasElement = true;
  }
  text = text.trim();
  if (text.length > 0) return { kind: "text", text };
  return hasElement ? { kind: "markup", length: body.trim().length } : { kind: "empty" };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64].map((char, value) => [char, value] as const));

function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "").replace(/=+$/, "");
  if (clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let buffer = 0;
  let length = 0;
  for (const char of clean) {
    const value = BASE64_VALUES.get(char);
    if (value === undefined) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, length);
}

class ExpansionLimit extends Error {}

/**
 * Inflated size of one compressed page, stopping as soon as it passes `budget`. Returns
 * `budget + 1` when the limit is passed and null when the payload is not deflate data.
 */
export function inflatedSize(payload: string, budget: number): number | null {
  const bytes = decodeBase64(payload);
  if (!bytes) return null;
  let total = 0;
  const inflator = new Inflate({ raw: true, chunkSize: 64 * 1024 });
  inflator.onData = (chunk) => {
    total += chunk.byteLength;
    if (total > budget) throw new ExpansionLimit();
  };
  inflator.onEnd = () => {};
  try {
    inflator.push(bytes, true);
  } catch (error) {
    if (error instanceof ExpansionLimit) return budget + 1;
    return null;
  }
  return inflator.err ? null : total;
}
