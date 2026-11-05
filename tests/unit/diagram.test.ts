import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDiagramXml, countPages } from "../../shared/diagram";

const page = (name: string, body: string) => `<diagram id="${name}" name="${name}">${body}</diagram>`;
const MODEL = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

describe("diagram source gate", () => {
  it("classifies empty and whitespace-only sources as empty", () => {
    assert.deepEqual(classifyDiagramXml(""), { status: "empty" });
    assert.deepEqual(classifyDiagramXml(" \n\t\r\n"), { status: "empty" });
  });

  it("accepts mxfile and bare mxGraphModel, with or without an XML declaration or BOM", () => {
    assert.equal(classifyDiagramXml(`<mxfile>${page("a", MODEL)}</mxfile>`).status, "ok");
    assert.equal(classifyDiagramXml(MODEL).status, "ok");
    assert.equal(classifyDiagramXml(`<?xml version="1.0" encoding="UTF-8"?>\n<mxfile>${page("a", MODEL)}</mxfile>`).status, "ok");
    assert.equal(classifyDiagramXml(`﻿<mxfile host="x">${page("a", MODEL)}</mxfile>`).status, "ok");
  });

  it("accepts a well-formed draw.io document that begins with an XML comment", () => {
    assert.equal(classifyDiagramXml(`<!-- generated -->\n<mxfile>${page("a", MODEL)}</mxfile>`).status, "ok");
  });

  it("rejects other XML, HTML, SVG, JSON and Mermaid", () => {
    for (const source of ["<svg/>", "<html><body/></html>", '{"a":1}', "graph TD; A-->B", "<mxfilex/>"]) {
      assert.equal(classifyDiagramXml(source).status, "not-drawio", source);
    }
  });

  it("enforces the size limit inclusively at the boundary", () => {
    const pad = (n: number) => MODEL + " ".repeat(0) + "<!--" + "x".repeat(n - MODEL.length - 7) + "-->";
    const atLimit = pad(100);
    assert.equal(atLimit.length, 100);
    assert.equal(classifyDiagramXml(atLimit, 100).status, "ok");
    const over = classifyDiagramXml(pad(101), 100);
    assert.deepEqual(over, { status: "too-large", chars: 101, limit: 100 });
  });

  it("reports pages and compression for multi-page and compressed files", () => {
    const multi = `<mxfile>${page("a", MODEL)}${page("b", MODEL)}${page("c", MODEL)}</mxfile>`;
    assert.deepEqual(classifyDiagramXml(multi), { status: "ok", pages: 3, compressed: false });
    const compressed = `<mxfile>${page("a", "7ZbBbqMwEIafhqvJ2jM2PibdaHvZS7rae4UaYlEMBkkFVsrbr4lJlUNXrVZSV6kPCPv7x/8MP2PJGJ1WK1qQUdmUW8lV0aEzwsGFFsTOMhTEzfpRbI3KBBYmdTQfTYqyBNKCNz")}</mxfile>`;
    assert.deepEqual(classifyDiagramXml(compressed), { status: "ok", pages: 1, compressed: true });
    assert.equal(countPages(MODEL), 1);
  });

  it("does not count <diagrams> or text mentioning diagram as pages", () => {
    const xml = `<mxfile><diagram id="a">${MODEL}</diagram><diagramx/></mxfile>`;
    assert.equal(countPages(xml), 1);
  });
});
