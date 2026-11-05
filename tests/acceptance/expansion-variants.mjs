// Page encodings for the expansion gate, each written as a .drawio file. "big" variants inflate
// to about 21.5 MB (limit 8,000,000); "small" variants inflate to a few hundred bytes.
// usage: node expansion-variants.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const out = process.argv[2];
const cell = '<mxCell id="x" value="v" vertex="1" parent="1"><mxGeometry width="1" height="1" as="geometry"/></mxCell>';
const model = (n) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell.repeat(n)}</root></mxGraphModel>`;
const b64 = (n) => zlib.deflateRawSync(Buffer.from(encodeURIComponent(model(n)))).toString("base64");
const wrap = (body, prolog = "", attrs = 'id="b" name="B"') => `${prolog}<mxfile><diagram ${attrs}>${body}</diagram></mxfile>`;
const dec = (s) => [...s].map((c) => `&#${c.charCodeAt(0)};`).join("");
const hex = (s) => [...s].map((c) => `&#x${c.charCodeAt(0).toString(16)};`).join("");
const variants = {};
for (const [size, n] of [["small", 3], ["big", 120000]]) {
  const p = b64(n);
  const h = Math.floor(p.length / 2);
  variants[`${size}-plain`] = wrap(p);
  variants[`${size}-decref`] = wrap(dec(p));
  variants[`${size}-hexref`] = wrap(hex(p));
  variants[`${size}-cdata`] = wrap(`<![CDATA[${p}]]>`);
  variants[`${size}-comment-split`] = wrap(`${p.slice(0, h)}<!-- split -->${p.slice(h)}`);
  variants[`${size}-mixed`] = wrap(`${dec(p.slice(0, 40))}<![CDATA[${p.slice(40, h)}]]>${p.slice(h)}`);
  variants[`${size}-text-plus-element`] = wrap(`${p}<mxGraphModel><root/></mxGraphModel>`);
  variants[`${size}-text-in-child`] = wrap(`<x>${p}</x>`);
  variants[`${size}-pi-split`] = wrap(`${p.slice(0, h)}<?s1 split?>${p.slice(h)}`);
  variants[`${size}-attr-gt`] = wrap(p, "", 'id="b" name="a > b"');
  variants[`${size}-malformed`] = `<mxfile><diagram id="m" name="M">${p}</mxfile>`;
  variants[`${size}-dtd-entity`] = wrap("&e;", `<!DOCTYPE mxfile [<!ENTITY e "${p}">]>`);
}
for (const [name, xml] of Object.entries(variants)) fs.writeFileSync(path.join(out, `${name}.drawio`), xml);
fs.writeFileSync(path.join(out, "names.txt"), Object.keys(variants).join(" "));
console.log(Object.keys(variants).join(" "));
