import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import { classifyDiagramXml } from "../../shared/diagram";

// The official viewer reads a page's text after XML parsing (entities and CDATA decoded),
// then base64-decodes and inflates it. The size gate must measure the same payload.
const cell = '<mxCell id="x" value="bomb" vertex="1" parent="1"><mxGeometry width="1" height="1" as="geometry"/></mxCell>';
const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell.repeat(120_000)}</root></mxGraphModel>`;
const b64 = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
const wrap = (body: string, prolog = "", attrs = 'id="b" name="B"') => `${prolog}<mxfile><diagram ${attrs}>${body}</diagram></mxfile>`;
const half = Math.floor(b64.length / 2);

describe("compressed page expansion gate matches what the viewer decodes", () => {
  it("refuses the plain over-limit page (control)", () => {
    assert.equal(classifyDiagramXml(wrap(b64)).status, "too-large");
  });

  it("refuses the same page when its base64 is written as character references", () => {
    const xml = wrap([...b64].map((c) => `&#${c.charCodeAt(0)};`).join(""));
    assert.ok(xml.length < 2_000_000);
    assert.equal(classifyDiagramXml(xml).status, "too-large");
  });

  it("refuses the same page when its base64 is wrapped in CDATA", () => {
    assert.equal(classifyDiagramXml(wrap(`<![CDATA[${b64}]]>`)).status, "too-large");
  });

  // Each case below was decoded by the pinned viewer (Editor.parseDiagramNode) to the full model.
  it("refuses the page when an element child sits beside the base64 text", () => {
    assert.equal(classifyDiagramXml(wrap(`${b64}<mxGraphModel><root/></mxGraphModel>`)).status, "too-large");
  });

  it("refuses the page when the base64 is the text of a child element", () => {
    assert.equal(classifyDiagramXml(wrap(`<x>${b64}</x>`)).status, "too-large");
  });

  it("refuses the page when a processing instruction splits the base64", () => {
    assert.equal(classifyDiagramXml(wrap(`${b64.slice(0, half)}<?s1 split?>${b64.slice(half)}`)).status, "too-large");
  });

  it("refuses the page when a diagram attribute contains an unescaped >", () => {
    assert.equal(classifyDiagramXml(wrap(b64, "", 'id="b" name="a > b"')).status, "too-large");
  });

  // Internal DTD entities are expanded only by the browser's XML parser. This shared prefilter
  // does not expand them by design; the viewer frame repeats the check on the browser's parse
  // before creating the viewer. That bound is proven in a real browser by
  // tests/acceptance/frame-expansion.mjs (variant big-dtd-entity) and its placement is asserted in
  // tests/unit/frame-html.test.ts.
});
