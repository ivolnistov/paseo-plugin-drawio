import type { PluginTimelineItem } from "@getpaseo/plugin";
import { TIMELINE_KINDS, TIMELINE_VERSION } from "./contracts";

export type Phase = "streaming" | "complete";

export type FenceSegment =
  | { kind: "text"; text: string; slot: number }
  | { kind: "diagram"; xml: string; index: number }
  | { kind: "pending"; index: number; chars: number };

type Container = { type: "quote" } | { type: "list"; width: number };

interface OpenFence {
  char: "`" | "~";
  length: number;
  indent: number;
  drawio: boolean;
  /** Offset of the opener line in the source text. */
  start: number;
  /** Number of enclosing containers when the fence opened; it closes with any of them. */
  depth: number;
  lines: string[];
}

const OPENER = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_MARKER = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function parseOpener(line: string): Omit<OpenFence, "start" | "depth" | "lines"> | null {
  const match = OPENER.exec(line);
  if (!match) return null;
  const marker = match[2]!;
  const info = match[3]!.trim();
  const char = marker[0] as "`" | "~";
  if (char === "`" && info.includes("`")) return null;
  const language = info.split(/\s+/)[0]?.toLowerCase() ?? "";
  return { char, length: marker.length, indent: match[1]!.length, drawio: language === "drawio" };
}

function isCloser(line: string, fence: OpenFence): boolean {
  const match = CLOSER.exec(line);
  if (!match) return false;
  const marker = match[1]!;
  return marker[0] === fence.char && marker.length >= fence.length;
}

function stripIndent(line: string, indent: number): string {
  let removed = 0;
  while (removed < indent && line[removed] === " ") removed += 1;
  return line.slice(removed);
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === " ") count += 1;
  return count;
}

/** Consumes the prefixes of already open containers; returns how many matched and the rest of the line. */
function continueContainers(line: string, containers: readonly Container[]): { matched: number; rest: string } {
  let rest = line;
  let matched = 0;
  for (const container of containers) {
    if (container.type === "quote") {
      const quote = QUOTE.exec(rest);
      if (!quote) break;
      rest = rest.slice(quote[0].length);
    } else if (rest.trim().length === 0) {
      rest = "";
    } else if (leadingSpaces(rest) >= container.width) {
      rest = rest.slice(container.width);
    } else {
      break;
    }
    matched += 1;
  }
  return { matched, rest };
}

/** Opens new block quotes and list items at the start of a line outside fenced code. */
function openContainers(line: string, containers: Container[]): string {
  let rest = line;
  for (;;) {
    const quote = QUOTE.exec(rest);
    if (quote) {
      containers.push({ type: "quote" });
      rest = rest.slice(quote[0].length);
      continue;
    }
    if (THEMATIC_BREAK.test(rest)) return rest;
    const item = LIST_MARKER.exec(rest);
    if (item && !CLOSER.test(rest)) {
      const indent = item[1]!.length;
      const marker = item[2]!.length;
      const spaces = item[3]!.length;
      // An empty item or five or more spaces put the content one column after the marker.
      const gap = spaces === 0 || spaces > 4 ? 1 : spaces;
      containers.push({ type: "list", width: indent + marker + gap });
      rest = rest.slice(indent + marker + Math.min(spaces, gap));
      continue;
    }
    return rest;
  }
}

/**
 * Splits assistant text into prose and drawio fences, following CommonMark fenced code rules
 * inside block quotes and list items. Fences of other languages are skipped whole, so a drawio
 * fence quoted inside them stays text. Prose keeps its original Markdown. Returns null when the
 * text has no drawio fence, so the host keeps its own rendering.
 */
export function splitDrawioFences(text: string, phase: Phase): FenceSegment[] | null {
  const segments: FenceSegment[] = [];
  const containers: Container[] = [];
  let textStart = 0;
  let index = 0;
  let open: OpenFence | null = null;
  let position = 0;

  const pushText = (end: number) => {
    const chunk = text.slice(textStart, end);
    if (chunk.trim().length > 0) segments.push({ kind: "text", text: chunk, slot: index });
  };
  const finishDiagram = (fence: OpenFence, resumeAt: number) => {
    pushText(fence.start);
    segments.push({ kind: "diagram", xml: fence.lines.join("\n"), index });
    index += 1;
    textStart = resumeAt;
  };

  for (;;) {
    const newline = text.indexOf("\n", position);
    const lineEnd = newline === -1 ? text.length : newline;
    const next = newline === -1 ? text.length : newline + 1;
    const line = text.slice(position, lineEnd).replace(/\r$/, "");
    // While streaming, the last line may still be missing its container prefix.
    const partial = phase === "streaming" && newline === -1;

    const { matched, rest: continued } = continueContainers(line, containers);
    if (partial && open && matched < open.depth) break;
    if (matched < containers.length) {
      // A fence ends with its container; the current line belongs to whatever follows.
      if (open && open.depth > matched) {
        if (open.drawio) finishDiagram(open, position);
        open = null;
      }
      containers.length = matched;
    }

    if (open) {
      if (isCloser(continued, open)) {
        if (open.drawio) finishDiagram(open, next);
        open = null;
      } else if (open.drawio) {
        open.lines.push(stripIndent(continued, open.indent));
      }
    } else {
      const rest = openContainers(continued, containers);
      const opener = parseOpener(rest);
      if (opener) open = { ...opener, start: position, depth: containers.length, lines: [] };
    }

    // A trailing newline ends the last line; there is no further empty line after it.
    if (newline === -1 || next >= text.length) break;
    position = next;
  }

  if (open?.drawio) {
    pushText(open.start);
    if (phase === "streaming") {
      segments.push({ kind: "pending", index, chars: open.lines.join("\n").length });
    } else {
      segments.push({ kind: "diagram", xml: open.lines.join("\n"), index });
    }
    index += 1;
    textStart = text.length;
  }

  if (index === 0) return null;
  pushText(text.length);
  return segments;
}

/** Plugin timeline items for one assistant message; ids are stable while the message streams but local to it. */
export function toTimelineItems(segments: readonly FenceSegment[], phase: Phase): PluginTimelineItem[] {
  return segments.map((segment): PluginTimelineItem => {
    switch (segment.kind) {
      case "text":
        return {
          type: "plugin",
          id: `text-${segment.slot}`,
          kind: TIMELINE_KINDS.text,
          version: TIMELINE_VERSION,
          data: { text: segment.text, phase },
        };
      case "diagram":
        return {
          type: "plugin",
          id: `diagram-${segment.index}`,
          kind: TIMELINE_KINDS.diagram,
          version: TIMELINE_VERSION,
          data: { xml: segment.xml, index: segment.index },
        };
      case "pending":
        return {
          type: "plugin",
          id: `diagram-${segment.index}`,
          kind: TIMELINE_KINDS.pending,
          version: TIMELINE_VERSION,
          data: { index: segment.index, chars: segment.chars },
        };
    }
  });
}

/**
 * Makes item ids unique across assistant messages. Paseo uses a transformed item's id as given,
 * so ids are prefixed with the message id. Without one, ids are dropped and the host derives
 * them from its own source row id and the item's position.
 */
export function scopeTimelineItems(items: readonly PluginTimelineItem[], messageId: string | undefined): PluginTimelineItem[] {
  return items.map((item) => {
    const { id, ...rest } = item;
    if (!messageId) return rest;
    return id === undefined ? rest : { ...rest, id: `${messageId}:${id}` };
  });
}
