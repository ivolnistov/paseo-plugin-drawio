// Worker thread for prepare_drawio_xml. Runs the official @drawio/mcp passes in the same order as
// its open_drawio_xml handler, then posts the XML back instead of building a browser URL.
// workerData: { sourceDir, content, postLayout, direction, routing, elkReady }
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

const LEAKABLE_OPTIONS = { postLayout: ["elk"], direction: ["vertical", "horizontal"], routing: ["libavoid"] };

const load = (sourceDir, file) => import(pathToFileURL(path.join(sourceDir, file)).href);
const reason = (error) => (error instanceof Error ? error.message : String(error));

async function prepare({ sourceDir, content, postLayout, direction, routing, elkReady }) {
  const notes = [];
  let xml = content;
  const options = { postLayout, direction, routing };

  try {
    const repair = await load(sourceDir, "repair-xml.js");
    const repaired = repair.repairDiagramXml(xml);
    xml = repaired.xml;
    const leaked = repair.leakedArguments(repaired.trailing, LEAKABLE_OPTIONS);
    for (const [key, value] of Object.entries(leaked)) {
      if (options[key] == null) {
        options[key] = value;
        notes.push(`${key} "${value}" was taken from text after the XML.`);
      }
    }
  } catch (error) {
    notes.push(`XML repair was skipped (${reason(error)}).`);
  }

  try {
    const normalize = await load(sourceDir, "normalize-model.js");
    xml = normalize.normalizeDiagram(xml).xml;
    const labels = await load(sourceDir, "label-perimeter.js");
    xml = labels.fitEdgeLabels(labels.addLabelPerimeters(xml).xml).xml;
  } catch (error) {
    notes.push(`Model normalization was skipped (${reason(error)}).`);
  }

  if (options.postLayout === "elk" && !elkReady) {
    notes.push(
      "ELK layout was skipped because the ELK bundle has not been prepared on this daemon; the other passes " +
        "still ran and the vertices keep the coordinates you supplied. The user can prepare it by running " +
        "\"npm run prepare-elk\" in the plugin folder.",
    );
  } else if (options.postLayout === "elk") {
    try {
      const elk = await load(sourceDir, "elk-pass.js");
      xml = await elk.layoutXml(xml, { direction: options.direction });
    } catch (error) {
      notes.push(`ELK layout did not run (${reason(error)}); the XML keeps the coordinates you supplied.`);
    }
  }

  if (options.routing === "libavoid") {
    // A local file path makes cdn-cache.js read the routing library bundled in @drawio/mcp
    // from disk, with no network request and no cache write.
    const cdnCache = await load(sourceDir, "cdn-cache.js");
    cdnCache.ROUTING_CORE.url = path.join(sourceDir, "..", "vendor", "libavoid", "libavoid-routing.js");
    // The official pass never throws: it returns the XML unchanged when routing does not apply.
    const routing = await load(sourceDir, "libavoid-pass.js");
    const routed = await routing.routeXml(xml);
    if (routed === xml) notes.push("Edge routing made no changes (no routable edges, or routing could not run).");
    xml = routed;
  }

  return { xml, notes };
}

prepare(workerData).then(
  (result) => parentPort.postMessage(result),
  (error) => parentPort.postMessage({ error: reason(error) }),
);
