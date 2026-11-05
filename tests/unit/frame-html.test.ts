import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildFrameHtml, FRAME_CSP } from "../../client/web";

const base = { viewerSource: "/*viewer*/", xml: "<mxfile/>", nonce: "n1", dark: false, background: "#ffffff", foreground: "#111111", fill: false };

function cspDirectives(csp: string) {
  return new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name!, values] as const;
  }));
}

describe("viewer frame document", () => {
  it("closes the network: no remote origin in any CSP directive", () => {
    const csp = cspDirectives(FRAME_CSP);
    assert.deepEqual(csp.get("default-src"), ["'none'"]);
    assert.deepEqual(csp.get("connect-src"), ["'none'"]);
    assert.deepEqual(csp.get("frame-src"), ["'none'"]);
    assert.deepEqual(csp.get("form-action"), ["'none'"]);
    assert.deepEqual([...(csp.get("img-src") ?? [])].sort(), ["blob:", "data:"]);
    assert.deepEqual(csp.get("font-src"), ["data:"]);
    for (const [name, values] of csp) {
      for (const value of values) assert.ok(!/^(https?:|\*|wss?:)/.test(value) && !value.includes("."), `${name} allows ${value}`);
    }
  });

  it("embeds the CSP as the first-loaded meta before any script", () => {
    const html = buildFrameHtml(base);
    const meta = html.indexOf('http-equiv="Content-Security-Policy"');
    assert.ok(meta > 0 && meta < html.indexOf("<script"));
    assert.ok(html.includes(`content="${FRAME_CSP}"`));
  });

  it("cannot be broken out of by hostile diagram XML", () => {
    const xml = '</script><script>parent.alert(1)</script><!--   ';
    const html = buildFrameHtml({ ...base, xml });
    assert.equal(html.split("</script>").length - 1, 2, "only the two plugin script blocks may close");
    assert.ok(!html.includes("<script>parent.alert"));
    const config = /var C=(\{.*?\});\n/s.exec(html)![1]!;
    assert.equal(JSON.parse(config).graph.xml, xml);
  });

  it("does not let theme colours inject CSS", () => {
    const html = buildFrameHtml({ ...base, background: "red;}body{background:url(https://example.invalid/x)", foreground: "#abc" });
    assert.ok(!html.includes("example.invalid"));
    assert.ok(html.includes("background:transparent"));
  });

  it("disables links, lightbox and passes dark mode to the official viewer", () => {
    const config = JSON.parse(/var C=(\{.*?\});\n/s.exec(buildFrameHtml({ ...base, dark: true }))![1]!);
    assert.equal(config.graph.lightbox, false);
    // The official GraphViewer only enables dark mode for "dark" (or "auto" with a dark scheme).
    assert.equal(config.graph["dark-mode"], "dark");
    const light = JSON.parse(/var C=(\{.*?\});\n/s.exec(buildFrameHtml({ ...base, dark: false }))![1]!);
    assert.ok(light.graph["dark-mode"] !== "dark" && light.graph["dark-mode"] !== "auto");
    assert.equal(config.graph["show-link-icons"], false);
    assert.equal(config.nonce, "n1");
  });

  it("keeps the real pinned viewer intact inside its script block", () => {
    const viewer = readFileSync(new URL("../../server/assets/viewer-static.min.js.txt", import.meta.url), "utf8");
    const html = buildFrameHtml({ ...base, viewerSource: viewer });
    assert.equal(html.split("</script>").length - 1, 2);
    const start = html.indexOf("<script>") + "<script>".length;
    const embedded = html.slice(start, html.indexOf("</script>", start));
    const changed = embedded.length - viewer.length;
    assert.ok(changed >= 0);
    // Escaping must only touch sequences that would end the script element early.
    assert.equal(embedded.replace(/<\\\/(script)/gi, "</$1").replace(/<\\!--/g, "<!--"), viewer);
  });

  it("checks the expanded size on the browser's own parse before any viewer is created", () => {
    const html = buildFrameHtml(base);
    const parse = html.indexOf("new DOMParser().parseFromString(C.graph.xml");
    const guard = html.indexOf("if(expandedSize(doc,C.maxExpandedBytes)>C.maxExpandedBytes)");
    const viewerElement = html.indexOf('el.className="mxgraph"');
    const viewer = html.indexOf("GraphViewer.createViewerForElement(");
    assert.ok(parse > 0 && guard > parse, "the size check must run on the parsed document");
    assert.ok(viewerElement > guard && viewer > guard, "no viewer element or viewer may be created before the size check");
    const config = JSON.parse(/var C=(\{.*?\});\n/s.exec(html)![1]!);
    assert.equal(config.maxExpandedBytes, 8_000_000);
  });
});
