// Runs (and awaits) prepareDiagramXml in a worker so an unbounded or looping implementation can be stopped.
import { parentPort, workerData } from "node:worker_threads";
const mod = await import(workerData.moduleUrl);
const t0 = performance.now();
let out;
try {
  const r = await mod.prepareDiagramXml(workerData.xml);
  out = { status: r.status, code: r.code, xmlLength: typeof r.xml === "string" ? r.xml.length : null };
} catch (error) {
  out = { threw: String(error?.message ?? error).slice(0, 200) };
}
parentPort.postMessage({ ...out, ms: Math.round(performance.now() - t0) });
