// Writes compressed-page variants whose inflated model is far above the 8,000,000-byte limit:
// plain base64, base64 with every char entity-encoded, and base64 inside CDATA.
// usage: node c0006-fixtures.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const out = process.argv[2];
const cell = '<mxCell id="x" value="bomb" vertex="1" parent="1"><mxGeometry width="1" height="1" as="geometry"/></mxCell>';
const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell.repeat(120000)}</root></mxGraphModel>`;
const b64 = zlib.deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
const wrap = (body) => `<mxfile><diagram id="b" name="B">${body}</diagram></mxfile>`;
const variants = {
  plain: wrap(b64),
  entities: wrap([...b64].map((c) => `&#${c.charCodeAt(0)};`).join("")),
  cdata: wrap(`<![CDATA[${b64}]]>`),
};
for (const [name, xml] of Object.entries(variants)) fs.writeFileSync(path.join(out, `${name}.drawio`), xml);
console.log(JSON.stringify({ inflatedChars: encodeURIComponent(model).length, sizes: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, v.length])) }));
