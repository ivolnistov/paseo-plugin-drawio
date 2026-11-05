// Worker body for xml-source.mjs: one libxml2 parse with internal entities substituted, network
// and external entities disabled. libxml2's amplification limit bounds expansion while it parses;
// the serialized result is checked against the output limit afterwards.
// workerData: { xml, maxOutputChars }
import { parentPort, workerData } from "node:worker_threads";
import { ParseOption, XmlDocument } from "libxml2-wasm";

// NOCDATA merges CDATA into text, so the canonical XML carries the same text content escaped.
const OPTIONS =
  ParseOption.XML_PARSE_NOENT |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NOCDATA |
  ParseOption.XML_PARSE_NOWARNING;

const error = (code, message) => ({ status: "error", code, message });

function classify(details) {
  const text = details.join(" ");
  if (/amplification|huge input|too large|maximum entity/i.test(text)) {
    return error("too-large", "The diagram's entities expand beyond the allowed size.");
  }
  if (/external (entity|subset|DTD)|PEReference|parameter entit/i.test(text)) {
    return error("external-entity", "The diagram uses an external or parameter entity, which is never loaded.");
  }
  return error("invalid-xml", `The diagram's XML could not be parsed: ${text.slice(0, 200) || "unknown error"}.`);
}

function prepare({ xml, maxOutputChars }) {
  let doc;
  try {
    doc = XmlDocument.fromString(xml, { option: OPTIONS });
  } catch (cause) {
    const details = Array.isArray(cause?.details) ? cause.details.map((detail) => String(detail.message).trim()) : [];
    return classify(details.length > 0 ? details : [String(cause?.message ?? cause)]);
  }
  try {
    const root = doc.root;
    // Serializing only the root element leaves out the DOCTYPE and its declarations.
    const canonical = root.toString({ format: false });
    if (canonical.length > maxOutputChars) {
      return error("too-large", `The expanded diagram has ${canonical.length} characters; the limit is ${maxOutputChars}.`);
    }
    return { status: "ok", xml: canonical };
  } finally {
    doc.dispose();
  }
}

parentPort.postMessage(prepare(workerData));
