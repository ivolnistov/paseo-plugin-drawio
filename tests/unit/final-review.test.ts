import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import { isDarkTheme } from "../../client/theme";
import { MAX_DIAGRAM_CHARS } from "../../shared/constants";
import { classifyDiagramXml } from "../../shared/diagram";

const cell = (i: number) => `<mxCell id="c${i}" value="v" vertex="1" parent="1"><mxGeometry width="1" height="1" as="geometry"/></mxCell>`;
const model = (n: number) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${Array.from({ length: n }, (_, i) => cell(i)).join("")}</root></mxGraphModel>`;
const compressed = (xml: string) => deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString("base64");
const theme = (surface0: string) => ({ colors: { surface0 } }) as never;

describe("expanded-size budget counts only inflated compressed pages", () => {
  it("accepts a document whose compressed pages fit even with a large uncompressed page", () => {
    const plain = model(14_000);
    const zipped = compressed(model(40_000));
    const inflated = encodeURIComponent(model(40_000)).length;
    const xml = `<mxfile><diagram id="p" name="Plain">${plain}</diagram><diagram id="z" name="Zip">${zipped}</diagram></mxfile>`;
    assert.ok(xml.length < MAX_DIAGRAM_CHARS, `source ${xml.length}`);
    assert.ok(inflated < 8_000_000 && inflated + plain.length > 8_000_000, `inflated ${inflated}, plain ${plain.length}`);
    assert.equal(classifyDiagramXml(xml).status, "ok");
  });
});

describe("source-size bound covers the text handed to the viewer", () => {
  it("refuses a source over the limit even when the excess is whitespace", () => {
    const body = model(10);
    const xml = body + " ".repeat(MAX_DIAGRAM_CHARS - body.length + 1);
    assert.equal(xml.length, MAX_DIAGRAM_CHARS + 1);
    const check = classifyDiagramXml(xml);
    assert.equal(check.status, "too-large");
    assert.equal((check as { chars: number }).chars, xml.length);
  });
});

describe("theme surface to viewer dark mode", () => {
  it("reads all six hex digits (#a0b0c0 is a light surface)", () => {
    assert.equal(isDarkTheme(theme("#a0b0c0")), false);
  });

  it("maps common light and dark surfaces", () => {
    for (const light of ["#ffffff", "#fff", "#f5f5f5", "#e0e4e8"]) assert.equal(isDarkTheme(theme(light)), false, light);
    for (const dark of ["#000000", "#000", "#1a1b26", "#18181b", "#202124"]) assert.equal(isDarkTheme(theme(dark)), true, dark);
  });
});
