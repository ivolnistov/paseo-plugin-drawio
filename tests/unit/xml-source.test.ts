import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { describe, it } from "node:test";
import { xmlProblem } from "../support/mcp-process.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE = path.join(ROOT, "server/xml-source.mjs");
const mod: any = existsSync(SOURCE) ? await import("../../server/xml-source.mjs").catch((error) => error) : new Error("server/xml-source.mjs does not exist");
const skip = mod instanceof Error ? `prepareDiagramXml unavailable: ${mod.message.split("\n")[0]}` : false;
const page = (body: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel>`;
const doc = (dtd: string, body: string) => `<!DOCTYPE mxfile [${dtd}]><mxfile><diagram id="d" name="D">${page(body)}</diagram></mxfile>`;
const vertex = (label: string) => `<mxCell id="v" value="${label}" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>`;

/** Runs one adversarial input in a worker with a heap cap and a wall-clock limit. */
function isolated(xml: string, timeoutMs = 10_000): Promise<{ status?: string; code?: string; threw?: string; ms?: number; timedOut?: boolean; crashed?: string }> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../support/xml-source-worker.mjs", import.meta.url), {
      workerData: { moduleUrl: pathToFileURL(SOURCE).href, xml },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
      execArgv: ["--experimental-transform-types", "--no-warnings", "--import", pathToFileURL(path.join(ROOT, "tests/support/register.mjs")).href],
    });
    const timer = setTimeout(() => { void worker.terminate(); resolve({ timedOut: true }); }, timeoutMs);
    worker.once("message", (m) => { clearTimeout(timer); void worker.terminate(); resolve(m); });
    worker.once("error", (e) => { clearTimeout(timer); resolve({ crashed: String(e.message).slice(0, 200) }); });
  });
}

// Contract: async prepareDiagramXml(xml) in server/xml-source.mjs, run on the daemon and reached by the
// client through an RPC, resolves to { status: "ok", xml } or { status: "error", code, message } with
// code "too-large" | "external-entity" | "invalid-xml". The parser's own amplification guard may refuse
// documents below the 2,000,000-character output cap; legitimate cases here stay far below both.
describe("prepareDiagramXml (DTD-safe source preparation)", () => {
  it("module server/xml-source.mjs exists and exports prepareDiagramXml", () => {
    assert.equal(mod instanceof Error, false, String(skip));
    assert.equal(typeof mod.prepareDiagramXml, "function");
    const pending = mod.prepareDiagramXml("<mxGraphModel/>");
    assert.equal(typeof pending?.then, "function", "prepareDiagramXml must return a promise");
    return pending;
  });

  it("returns documents without a DOCTYPE unchanged", { skip }, async () => {
    const inputs = [
      `<mxfile><diagram id="d" name="D">${page(vertex("Plain &amp; &#65; &#x42;"))}</diagram></mxfile>`,
      page(vertex("bare model")),
      `<mxfile><diagram id="z" name="Z"><![CDATA[7ZZBb4]]></diagram></mxfile>`,
      `<?xml version="1.0"?>\n<!-- note --><mxfile><diagram id="d">${page("")}</diagram></mxfile>`,
    ];
    for (const xml of inputs) assert.deepEqual(await mod.prepareDiagramXml(xml), { status: "ok", xml });
  });

  it("refuses a source over 2,000,000 characters before parsing", { skip }, async () => {
    const big = `<mxfile>${" ".repeat(2_000_001)}</mxfile>`;
    const r = await mod.prepareDiagramXml(big);
    assert.equal(r.status, "error");
    assert.equal(r.code, "too-large");
  });

  it("expands a single internal entity and removes the DOCTYPE", { skip }, async () => {
    const r = await mod.prepareDiagramXml(doc('<!ENTITY who "Alice">', vertex("Hello &who;")));
    assert.equal(r.status, "ok");
    assert.ok(!/<!DOCTYPE/i.test(r.xml), "DOCTYPE kept");
    assert.ok(!r.xml.includes("&who;"));
    assert.match(r.xml, /value="Hello Alice"/);
    assert.equal(xmlProblem(r.xml), null, String(xmlProblem(r.xml)));
  });

  it("expands nested internal entities within the budget", { skip }, async () => {
    const r = await mod.prepareDiagramXml(doc('<!ENTITY a "Ali"><!ENTITY b "&a;ce">', vertex("Hi &b;")));
    assert.equal(r.status, "ok", JSON.stringify(r).slice(0, 200));
    assert.match(r.xml, /value="Hi Alice"/);
  });

  it("expands an entity used as page text, so the page payload is what the viewer reads", { skip }, async () => {
    const r = await mod.prepareDiagramXml(`<!DOCTYPE mxfile [<!ENTITY p "7ZZBb4">]><mxfile><diagram id="d" name="D">&p;</diagram></mxfile>`);
    assert.equal(r.status, "ok");
    assert.match(r.xml, /<diagram[^>]*>\s*7ZZBb4\s*<\/diagram>/);
  });

  it("keeps CDATA, numeric references and attribute text meaning", { skip }, async () => {
    const r = await mod.prepareDiagramXml(`<!DOCTYPE mxfile [<!ENTITY e "x">]><mxfile><diagram id="d" name="&#65;&e;"><![CDATA[<b>raw</b>]]></diagram></mxfile>`);
    assert.equal(r.status, "ok");
    assert.equal(xmlProblem(r.xml), null, String(xmlProblem(r.xml)));
    assert.match(r.xml, /name="(A|&#65;|&#x41;)x"/);
    assert.ok(!/<b>raw<\/b>/.test(r.xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")), "CDATA text became markup");
    assert.match(r.xml, /<!\[CDATA\[<b>raw<\/b>\]\]>|&lt;b&gt;raw&lt;\/b&gt;/);
  });

  it("fails closed on external and parameter entities, without fetching", { skip }, async () => {
    for (const xml of [
      doc('<!ENTITY ext SYSTEM "http://127.0.0.1:9/x.xml">', vertex("&ext;")),
      doc('<!ENTITY ext PUBLIC "-//X//EN" "http://127.0.0.1:9/x.xml">', vertex("&ext;")),
      doc('<!ENTITY % p "x"> %p;', vertex("v")),
      `<!DOCTYPE mxfile SYSTEM "http://127.0.0.1:9/x.dtd"><mxfile><diagram id="d">${page("")}</diagram></mxfile>`,
    ]) {
      const r = await mod.prepareDiagramXml(xml);
      assert.equal(r.status, "error", xml.slice(0, 80));
      assert.equal(r.code, "external-entity", `${xml.slice(0, 80)} -> ${r.code}`);
    }
  });

  it("reports malformed XML with a DOCTYPE as invalid-xml", { skip }, async () => {
    const r = await mod.prepareDiagramXml(`<!DOCTYPE mxfile [<!ENTITY e "x">]><mxfile><diagram>&e;</mxfile>`);
    assert.equal(r.status, "error");
    assert.equal(r.code, "invalid-xml");
  });

  it("refuses quadratic expansion over the 2,000,000-character cap quickly", { skip }, async () => {
    const r = await isolated(doc(`<!ENTITY q "${"a".repeat(100_000)}">`, vertex("&q;".repeat(30))));
    assert.equal(r.timedOut, undefined, "did not finish");
    assert.equal(r.status, "error", JSON.stringify(r));
    assert.equal(r.code, "too-large");
    assert.ok((r.ms ?? 0) < 2000, `${r.ms} ms`);
  });

  it("refuses exponential nesting before materializing it", { skip }, async () => {
    let dtd = '<!ENTITY l0 "aaaaaaaaaa">';
    for (let i = 1; i <= 6; i++) dtd += `<!ENTITY l${i} "${`&l${i - 1};`.repeat(10)}">`;
    const r = await isolated(doc(dtd, vertex("&l6;")));
    assert.equal(r.timedOut, undefined, "did not finish");
    assert.equal(r.crashed, undefined, String(r.crashed));
    assert.equal(r.status, "error", JSON.stringify(r));
    assert.equal(r.code, "too-large");
  });

  it("refuses entity cycles instead of looping", { skip }, async () => {
    const r = await isolated(doc('<!ENTITY a "&b;"><!ENTITY b "&a;">', vertex("&a;")));
    assert.equal(r.timedOut, undefined, "looped");
    assert.equal(r.status, "error", JSON.stringify(r));
  });

  it("returns canonical output without a DOCTYPE and under the 2,000,000-character cap", { skip }, async () => {
    const cases = [
      doc('<!ENTITY who "Alice">', vertex("&who;")),
      doc('<!ENTITY a "Ali"><!ENTITY b "&a;ce">', vertex("&b; &b;")),
      doc(`<!ENTITY q "${"a".repeat(1000)}">`, vertex("&q;".repeat(50))),
    ];
    for (const xml of cases) {
      const r = await mod.prepareDiagramXml(xml);
      assert.equal(r.status, "ok", JSON.stringify(r).slice(0, 200));
      assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(r.xml), "DTD left in the output");
      assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(r.xml), "unresolved or bare entity reference");
      assert.ok(r.xml.length <= 2_000_000);
      assert.equal(xmlProblem(r.xml), null, String(xmlProblem(r.xml)));
      assert.match(r.xml, /^\s*(<\?xml[^>]*\?>\s*)?<mxfile[\s>]/);
    }
  });

  // SYSTEM and PUBLIC are only external identifiers right after the declared name of a DOCTYPE,
  // ENTITY or NOTATION. Elsewhere they are ordinary names or text.
  it("accepts internal declarations whose names or values contain SYSTEM or PUBLIC", { skip }, async () => {
    const cases: Array<[string, RegExp]> = [
      [doc('<!ENTITY SYSTEM "Sys">', vertex("&SYSTEM;")), /value="Sys"/],
      [doc('<!ENTITY PUBLIC "Pub">', vertex("&PUBLIC;")), /value="Pub"/],
      [doc('<!ENTITY SYSTEM "Sys"><!ENTITY nested "&SYSTEM;tem">', vertex("&nested;")), /value="System"/],
      [doc('<!ENTITY e "SYSTEM PUBLIC">', vertex("&e;")), /value="SYSTEM PUBLIC"/],
      [doc('<!ELEMENT SYSTEM ANY><!ENTITY e "ok">', vertex("&e;")), /value="ok"/],
      [doc('<!ATTLIST mxCell tag CDATA "SYSTEM PUBLIC"><!ENTITY e "ok">', vertex("&e;")), /value="ok"/],
      [`<!DOCTYPE SYSTEM [<!ENTITY e "ok">]><mxfile><diagram id="d" name="D">${page(vertex("&e;"))}</diagram></mxfile>`, /value="ok"/],
      [`<!DOCTYPE PUBLIC [<!ENTITY e "ok">]><mxfile><diagram id="d" name="D">${page(vertex("&e;"))}</diagram></mxfile>`, /value="ok"/],
    ];
    const wrong: string[] = [];
    for (const [xml, expected] of cases) {
      const r = await mod.prepareDiagramXml(xml);
      const good = r.status === "ok" && expected.test(r.xml) && !/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/.test(r.xml);
      if (!good) wrong.push(`${xml.slice(0, xml.indexOf("]>") + 2)} -> ${r.status} ${r.code ?? ""}`);
    }
    assert.deepEqual(wrong, []);
  });

  it("still refuses real external identifiers after a declared name", { skip }, async () => {
    for (const xml of [
      doc('<!ENTITY SYSTEM SYSTEM "http://127.0.0.1:9/x.xml">', vertex("&SYSTEM;")),
      doc('<!ENTITY e PUBLIC "-//X//EN" "http://127.0.0.1:9/x.xml">', vertex("&e;")),
      `<!DOCTYPE mxfile PUBLIC "-//X//EN" "http://127.0.0.1:9/x.dtd"><mxfile><diagram id="d">${page("")}</diagram></mxfile>`,
    ]) {
      const r = await mod.prepareDiagramXml(xml);
      assert.equal(r.code, "external-entity", `${xml.slice(0, 80)} -> ${r.status} ${r.code}`);
    }
  });
});
