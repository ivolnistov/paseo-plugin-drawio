import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitDrawioFences, toTimelineItems, type FenceSegment } from "../../shared/fences";

const XML = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
const diagrams = (segments: FenceSegment[] | null) =>
  (segments ?? []).filter((s) => s.kind === "diagram").map((s) => (s as { xml: string }).xml);
const ids = (text: string, phase: "streaming" | "complete") => {
  const segments = splitDrawioFences(text, phase);
  return segments ? toTimelineItems(segments, phase).map((i) => `${i.kind}:${i.id}`) : null;
};

describe("drawio fence detection (CommonMark fenced code blocks)", () => {
  it("leaves messages without a drawio fence to the host", () => {
    assert.equal(splitDrawioFences("plain text", "complete"), null);
    assert.equal(splitDrawioFences("```xml\n" + XML + "\n```", "complete"), null);
    assert.equal(splitDrawioFences("inline ```drawio``` mention", "complete"), null);
  });

  it("splits prose and every drawio fence in order", () => {
    const text = `Intro\n\n\`\`\`drawio\n${XML}\n\`\`\`\n\nMiddle [link](a.drawio)\n\n~~~drawio\n<mxfile/>\n~~~\nEnd`;
    const segments = splitDrawioFences(text, "complete")!;
    assert.deepEqual(segments.map((s) => s.kind), ["text", "diagram", "text", "diagram", "text"]);
    assert.deepEqual(diagrams(segments), [XML, "<mxfile/>"]);
    assert.match((segments[2] as { text: string }).text, /\[link\]\(a\.drawio\)/);
  });

  it("accepts info strings with attributes after the language", () => {
    assert.deepEqual(diagrams(splitDrawioFences("```drawio title=x\n" + XML + "\n```", "complete")), [XML]);
  });

  it("does not treat other languages that start with drawio as drawio", () => {
    assert.equal(splitDrawioFences("```drawio-xml\n" + XML + "\n```", "complete"), null);
    assert.equal(splitDrawioFences("```xml drawio\n" + XML + "\n```", "complete"), null);
  });

  it("rejects a backtick opener whose info string contains a backtick", () => {
    assert.equal(splitDrawioFences("```drawio `x`\n" + XML + "\n```", "complete"), null);
  });

  it("keeps a shorter or different-character inner fence as diagram content", () => {
    const body = "line\n```\n~~~~\nend";
    const segments = splitDrawioFences("````drawio\n" + body + "\n````", "complete");
    assert.deepEqual(diagrams(segments), [body]);
  });

  it("closes on a longer closer but not on a closer with an info string", () => {
    assert.deepEqual(diagrams(splitDrawioFences("```drawio\nA\n`````\nafter", "complete")), ["A"]);
    const segs = splitDrawioFences("```drawio\nA\n```js\nB\n```", "complete");
    assert.deepEqual(diagrams(segs), ["A\n```js\nB"]);
  });

  it("strips up to the opener indentation from content lines", () => {
    const text = "  ```drawio\n  <mxfile>\n <a/>\n    <b/>\n  </mxfile>\n  ```";
    assert.deepEqual(diagrams(splitDrawioFences(text, "complete")), ["<mxfile>\n<a/>\n  <b/>\n</mxfile>"]);
  });

  it("does not treat a four-space indented fence as a fence", () => {
    assert.equal(splitDrawioFences("    ```drawio\n    " + XML + "\n    ```", "complete"), null);
  });

  it("keeps a drawio fence quoted inside a longer outer fence as text", () => {
    const text = "````markdown\n```drawio\n" + XML + "\n```\n````";
    assert.equal(splitDrawioFences(text, "complete"), null);
  });

  it("keeps a drawio fence quoted inside a tilde fence as text", () => {
    const text = "~~~md\n```drawio\n" + XML + "\n```\n~~~";
    assert.equal(splitDrawioFences(text, "complete"), null);
  });

  // CommonMark: a fenced code block inside a block quote or list item is still a code block
  // with info string "drawio". The design requires every drawio fence in the message to render.
  it("detects a drawio fence inside a block quote", () => {
    const text = "> ```drawio\n> " + XML + "\n> ```";
    assert.deepEqual(diagrams(splitDrawioFences(text, "complete")), [XML]);
  });

  it("detects a drawio fence inside a list item", () => {
    const text = "- item\n\n  ```drawio\n  " + XML + "\n  ```";
    assert.deepEqual(diagrams(splitDrawioFences(text, "complete")), [XML]);
  });

  it("detects a drawio fence that starts on the list marker line", () => {
    const text = "- ```drawio\n  " + XML + "\n  ```";
    assert.deepEqual(diagrams(splitDrawioFences(text, "complete")), [XML]);
  });

  it("detects a drawio fence in a wide ordered list item (content column 4)", () => {
    const text = "10. item\n\n    ```drawio\n    " + XML + "\n    ```";
    assert.deepEqual(diagrams(splitDrawioFences(text, "complete")), [XML]);
  });

  it("normalises CRLF line endings out of diagram content", () => {
    const text = "Intro\r\n```drawio\r\n<mxfile>\r\n<a/>\r\n</mxfile>\r\n```\r\nEnd\r\n";
    const segments = splitDrawioFences(text, "complete")!;
    assert.deepEqual(diagrams(segments), ["<mxfile>\n<a/>\n</mxfile>"]);
    assert.ok(!diagrams(segments)[0]!.includes("\r"));
  });

  it("handles CRLF fences with blank CRLF lines between multiple fences", () => {
    const text = "```drawio\r\n<a/>\r\n```\r\n\r\n\r\n```drawio\r\n<b/>\r\n```\r\n";
    assert.deepEqual(diagrams(splitDrawioFences(text, "complete")), ["<a/>", "<b/>"]);
  });

  it("renders an unclosed fence at completion (runs to end of document)", () => {
    assert.deepEqual(diagrams(splitDrawioFences("```drawio\n" + XML, "complete")), [XML]);
  });

  it("returns an empty diagram for an empty fence instead of dropping it", () => {
    assert.deepEqual(diagrams(splitDrawioFences("```drawio\n```", "complete")), [""]);
  });
});

describe("streaming revisions", () => {
  const full = `Here:\n\n\`\`\`drawio\n${XML}\n\`\`\`\n\nDone.\n\n\`\`\`drawio\n<mxfile/>\n\`\`\``;

  it("shows a pending row for an unclosed fence while streaming, never a diagram", () => {
    const segments = splitDrawioFences("Here:\n\n```drawio\n<mxGraphMo", "streaming")!;
    assert.deepEqual(segments.map((s) => s.kind), ["text", "pending"]);
    assert.equal((segments[1] as { chars: number }).chars, "<mxGraphMo".length);
  });

  it("keeps every prefix of a streamed reply valid with unique ids and stable identity", () => {
    const seen = new Map<string, string>();
    for (let end = 1; end <= full.length; end += 1) {
      const items = ids(full.slice(0, end), end === full.length ? "complete" : "streaming");
      if (!items) continue;
      const idList = items.map((s) => s.split(":")[1]);
      assert.equal(new Set(idList).size, idList.length, `duplicate ids at prefix ${end}: ${items}`);
      for (const entry of items) {
        const [kind, id] = entry.split(":");
        const family = kind === "drawio-text" ? "text" : "diagram";
        const previous = seen.get(id!);
        if (previous) assert.equal(previous, family, `id ${id} changed family at prefix ${end}`);
        seen.set(id!, family);
      }
    }
    assert.deepEqual(ids(full, "complete"), [
      "drawio-text:text-0",
      "drawio-diagram:diagram-0",
      "drawio-text:text-1",
      "drawio-diagram:diagram-1",
    ]);
  });

  it("does not render a half-typed closer as a closed diagram", () => {
    const segments = splitDrawioFences("```drawio\n<a/>\n``", "streaming")!;
    assert.deepEqual(segments.map((s) => s.kind), ["pending"]);
  });

  it("produces JSON-serialisable items with the declared kind and version", () => {
    const items = toTimelineItems(splitDrawioFences(full, "complete")!, "complete");
    assert.deepEqual(JSON.parse(JSON.stringify(items)), items);
    for (const item of items) {
      assert.equal(item.type, "plugin");
      assert.equal(item.version, 1);
    }
  });
});
