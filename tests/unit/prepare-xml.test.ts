import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { killAllSpawned, McpProcess } from "../support/mcp-process.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const mod: any = await import("../../server/launcher/prepare-xml.mjs").catch((error) => error);
const missing = mod instanceof Error ? `prepare-xml.mjs not loadable: ${mod.message.split("\n")[0]}` : false;
after(() => killAllSpawned());
const CONTRACT_SENTENCE = "Repairs, normalizes and optionally lays out draw.io XML with the official draw.io engine and returns the resulting XML.";

/** Error text when a validation result or throw signals failure, else null. */
function validationError(args: unknown): string | null {
  try {
    const r = mod.validatePrepareArguments(args);
    if (r && (r.error || r.isError || r.ok === false || r.valid === false)) return JSON.stringify(r);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("prepare_drawio_xml helpers", () => {
  it("module exists and loads without starting anything", () => {
    assert.equal(mod instanceof Error, false, String(missing));
  });

  let official: any;
  before(async () => {
    const upstream = new McpProcess([path.join(ROOT, "node_modules/@drawio/mcp/src/index.js")]);
    await upstream.init();
    upstream.send({ id: "list", method: "tools/list" });
    official = (await upstream.reply("list")).result.tools.find((t: any) => t.name === "open_drawio_xml");
    upstream.child.kill("SIGTERM");
    await upstream.exited();
  });

  it("names the tool prepare_drawio_xml", { skip: missing }, () => {
    assert.equal(mod.PREPARE_TOOL_NAME, "prepare_drawio_xml");
  });

  it("derives its schema from the official open_drawio_xml schema", { skip: missing }, () => {
    const tool = mod.buildPrepareTool(official);
    assert.equal(tool.name, "prepare_drawio_xml");
    const schema = tool.inputSchema;
    assert.equal(schema.type, "object");
    assert.deepEqual(schema.required, ["content"]);
    assert.equal(schema.properties.content.type, "string");
    assert.deepEqual(schema.properties.postLayout.enum, official.inputSchema.properties.postLayout.enum);
    assert.deepEqual(schema.properties.direction.enum, official.inputSchema.properties.direction.enum);
    for (const dropped of ["lightbox", "dark"]) assert.equal(dropped in schema.properties, false, dropped);
    // Owner decision R2: the official libavoid routing option is offered as published.
    assert.deepEqual(schema.properties.routing.enum, official.inputSchema.properties.routing.enum);
  });

  it("keeps the official XML guidance and replaces only the opening sentence", { skip: missing }, () => {
    const tool = mod.buildPrepareTool(official);
    assert.ok(tool.description.startsWith(CONTRACT_SENTENCE), tool.description.slice(0, 120));
    assert.match(tool.description, /does not open anything and does not write files/);
    const officialTail = official.description.slice(official.description.indexOf(".") + 1).trim().slice(0, 200);
    assert.ok(tool.description.includes(officialTail), "official guidance after the first sentence is kept");
    assert.ok(!/opens? (the diagram )?in (your|the) (default )?browser/i.test(tool.description.slice(0, 400)));
  });

  it("falls back to a fixed description when the official tool is missing", { skip: missing }, () => {
    const tool = mod.buildPrepareTool(undefined);
    assert.ok(tool.description.startsWith(CONTRACT_SENTENCE));
    assert.deepEqual(tool.inputSchema.required, ["content"]);
  });

  it("accepts the valid argument shapes", { skip: missing }, () => {
    const xml = "<mxGraphModel><root/></mxGraphModel>";
    for (const args of [{ content: xml }, { content: xml, postLayout: "elk" }, { content: xml, postLayout: "elk", direction: "horizontal" }, { content: xml, postLayout: "elk", direction: "vertical" }, { content: xml, routing: "libavoid" }, { content: xml, postLayout: "elk", routing: "libavoid" }]) {
      assert.equal(validationError(args), null, JSON.stringify(args));
    }
  });

  it("refuses invalid arguments and names the field", { skip: missing }, () => {
    const cases: Array<[unknown, RegExp]> = [
      [{}, /content/],
      [{ content: 42 }, /content/],
      [{ content: "x".repeat(2_000_001) }, /content/],
      [{ content: "<a/>", postLayout: "dagre" }, /postLayout/],
      [{ content: "<a/>", postLayout: "elk", direction: "diagonal" }, /direction/],
      [{ content: "<a/>", direction: "horizontal" }, /direction/],
      [{ content: "<a/>", routing: "orthogonal" }, /routing/],
    ];
    for (const [args, field] of cases) {
      const error = validationError(args);
      assert.ok(error, `accepted ${JSON.stringify(args).slice(0, 80)}`);
      assert.match(error!, field);
    }
  });

  it("returns the XML first and notes only when there are any", { skip: missing }, () => {
    const xml = "<mxGraphModel><root/></mxGraphModel>";
    const plain = mod.formatPrepareResult({ xml, notes: [] });
    assert.deepEqual(plain.content, [{ type: "text", text: xml }]);
    assert.notEqual(plain.isError, true);
    const noted = mod.formatPrepareResult({ xml, notes: ["ELK layout did not run: test"] });
    assert.equal(noted.content[0].text, xml);
    assert.equal(noted.content.length, 2);
    assert.match(noted.content[1].text, /ELK layout did not run: test/);
  });

  it("reports an oversized result as an error instead of truncated XML", { skip: missing }, () => {
    const big = `<mxGraphModel>${"x".repeat(8_000_001)}</mxGraphModel>`;
    const result = mod.formatPrepareResult({ xml: big, notes: [] });
    assert.equal(result.isError, true);
    assert.ok(!result.content.some((c: any) => typeof c.text === "string" && c.text.length > 8_000_000));
  });
});
