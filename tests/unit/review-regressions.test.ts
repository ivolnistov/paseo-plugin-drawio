import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import contribute from "../../index.client.tsx";
import { classifyDiagramXml, countPages } from "../../shared/diagram";
import { splitDrawioFences, type FenceSegment } from "../../shared/fences";

const kinds = (s: FenceSegment[] | null) => (s ?? []).map((x) => x.kind);
const xmlOf = (s: FenceSegment[] | null) => (s ?? []).filter((x) => x.kind === "diagram").map((x) => (x as { xml: string }).xml);

function registered() {
  const out: { transform?: any; slash?: any } = {};
  contribute({
    addFilePanel: () => () => {},
    addTimelineRenderer: () => () => {},
    addTimelineTransformer: (c: any) => { out.transform = c.transform; return () => {}; },
    addSlashCommand: (c: any) => { out.slash = c; return () => {}; },
  } as never);
  return out;
}

describe("streamed container fences stay pending until closed", () => {
  const cases = {
    quote: "> ```drawio\n> <mxGraphModel>\n> <root/>\n> </mxGraphModel>\n> ```\n\nAfter.",
    list: "- ```drawio\n  <mxGraphModel>\n  <root/>\n  </mxGraphModel>\n  ```\n\nAfter.",
  };
  for (const [name, full] of Object.entries(cases)) {
    it(`${name}: no prefix before the closing fence renders a diagram`, () => {
      const closeAt = full.lastIndexOf("```") + 3;
      for (let end = full.indexOf("drawio") + 7; end < closeAt; end += 1) {
        const got = kinds(splitDrawioFences(full.slice(0, end), "streaming"));
        assert.ok(!got.includes("diagram"), `${name} prefix ${end} ${JSON.stringify(full.slice(0, end).slice(-12))} -> ${got}`);
        assert.ok(got.includes("pending"), `${name} prefix ${end} ${JSON.stringify(full.slice(0, end).slice(-12))} has no pending row -> ${got}`);
      }
      assert.deepEqual(xmlOf(splitDrawioFences(full, "complete")), ["<mxGraphModel>\n<root/>\n</mxGraphModel>"]);
    });
  }
});

describe("thematic breaks are not list items", () => {
  for (const hr of ["- - -", "* * *", "-  -  -"]) {
    it(`"${hr}" before a two-space indented fence leaves a top-level fence`, () => {
      const text = `${hr}\n\n  \`\`\`drawio\n  <mxGraphModel/>\n  \`\`\`\n\nAfter.`;
      assert.deepEqual(xmlOf(splitDrawioFences(text, "complete")), ["<mxGraphModel/>"]);
    });
    it(`"${hr}" before a two-space fence whose content starts at column 0`, () => {
      const text = `${hr}\n\n  \`\`\`drawio\n<mxGraphModel>\n<root/>\n</mxGraphModel>\n  \`\`\`\n\nAfter.`;
      assert.deepEqual(xmlOf(splitDrawioFences(text, "complete")), ["<mxGraphModel>\n<root/>\n</mxGraphModel>"]);
    });
  }
});

describe("transformer without a message id", () => {
  it("omits item ids so the host scopes them by source row", () => {
    const { transform } = registered();
    const out = transform({ item: { type: "assistant_message", text: "a\n\n```drawio\n<mxGraphModel/>\n```\n\nb" }, phase: "complete" });
    assert.ok(out.items.length >= 2);
    for (const item of out.items) assert.equal("id" in item && item.id !== undefined, false, JSON.stringify(item));
  });
});

describe("/drawio while the agent is running", () => {
  it("does not send with the daemon default (which interrupts the active turn)", async () => {
    const { slash } = registered();
    const sent: Array<{ text: string; options?: { activeTurnBehavior?: string } }> = [];
    const paseo = { agents: { ref: () => ({ send: async (text: string, options?: any) => { sent.push({ text, options }); } }) } };
    let refusal: unknown = null;
    try {
      await slash.onSubmit({ args: "login flow", agent: { id: "a1", status: "running" }, paseo });
    } catch (error) {
      refusal = error;
    }
    if (refusal) {
      // Refusing is acceptable only if nothing reached the agent and the user keeps the request.
      assert.equal(sent.length, 0, "sent to a running agent before refusing");
      assert.match(String((refusal as Error).message), /login flow/);
      return;
    }
    assert.fail(`sent to a running agent instead of refusing: ${JSON.stringify(sent.map((s) => s.options ?? null))}`);
  });
});

describe("compressed page expansion is bounded", () => {
  it("does not accept a small compressed page that inflates far beyond the size limit", () => {
    const cell = '<mxCell id="x" value="bomb" vertex="1" parent="1"><mxGeometry width="1" height="1" as="geometry"/></mxCell>';
    const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell.repeat(200_000)}</root></mxGraphModel>`;
    const payload = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
    const file = `<mxfile><diagram id="p" name="p">${payload}</diagram></mxfile>`;
    assert.ok(file.length < 2_000_000 && model.length > 20_000_000, `fixture ${file.length} -> ${model.length}`);
    assert.notEqual(classifyDiagramXml(file).status, "ok");
  });
});

describe("page counting", () => {
  it("counts attribute-less self-closing pages and ignores CDATA text", () => {
    assert.equal(countPages("<mxfile><diagram/><diagram/></mxfile>"), 2);
    assert.equal(countPages('<mxfile><diagram id="a"><![CDATA[<diagram id="fake">]]></diagram></mxfile>'), 1);
  });
});
