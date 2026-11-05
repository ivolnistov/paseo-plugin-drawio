// Runs the worker at workerData.workerUrl in this thread behind a fetch trap; its reply gains
// `probe`: the URLs fetch was asked for and whether the cached sentinel library was evaluated.
import { parentPort, workerData } from "node:worker_threads";

const fetches = [];
globalThis.fetch = async (input) => {
  fetches.push(String(input?.url ?? input));
  // Answer as the CDN would, so a fetch that is tried also leads to a cache write.
  return new Response(workerData.trapSource, { status: 200, headers: { etag: '"trap"' } });
};

const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (message) =>
  post({ ...message, probe: { fetches, sentinelEvaluated: globalThis.__drawioRoutingSentinel === true } });

await import(workerData.workerUrl);
