// Stand-in prepare worker that starts (leaves a marker) and never answers, to test closing a busy runner.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { threadId, workerData } from "node:worker_threads";
writeFileSync(path.join(workerData.sourceDir, `started-${threadId}`), "1");
setInterval(() => {}, 1000);
