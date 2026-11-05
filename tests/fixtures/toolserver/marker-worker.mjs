// Stand-in prepare worker: records that it started (a file in workerData.sourceDir) and answers.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parentPort, threadId, workerData } from "node:worker_threads";
writeFileSync(path.join(workerData.sourceDir, `started-${threadId}`), "1");
parentPort.postMessage({ xml: "<mxGraphModel><root/></mxGraphModel>", notes: [] });
