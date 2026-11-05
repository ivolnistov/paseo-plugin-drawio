import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createPrepareRunner } from "../../server/launcher/drawio-toolserver.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKER = path.join(ROOT, "tests/fixtures/toolserver/marker-worker.mjs");
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "drawio-s1-runner-")));
const runners: Array<{ close(): Promise<void> }> = [];
after(async () => {
  for (const r of runners) await r.close().catch(() => {});
  rmSync(scratch, { recursive: true, force: true });
});

let n = 0;
function setup(workerPath = WORKER) {
  const dir = path.join(scratch, `case-${++n}`);
  mkdirSync(dir);
  const runner = createPrepareRunner({ sourceDir: dir, cacheHome: path.join(dir, "cache"), workerPath, timeoutMs: 5000 });
  runners.push(runner);
  return { dir, runner, starts: () => readdirSync(dir).filter((f) => f.startsWith("started-")).length };
}
const args = { content: "<mxGraphModel><root/></mxGraphModel>" };
/** Settles to the value, or to "pending" once the bound passes. */
const within = <T>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<"pending">((r) => setTimeout(() => r("pending"), ms))]);
/** Gives a wrongly resumed start() time to spawn a worker that would leave its marker. */
const quietPeriod = () => new Promise((r) => setTimeout(r, 1500));

describe("prepare runner shutdown", () => {
  it("control: a call without close starts one worker and answers", async () => {
    const { runner, starts } = setup();
    const result: any = await within(runner.run(args));
    assert.notEqual(result, "pending");
    assert.equal(result.isError, undefined);
    assert.equal(starts(), 1);
  });

  it("closing right after a call is accepted does not throw, settles the call and starts no worker", async () => {
    const { runner, starts } = setup();
    const call = runner.run(args); // start() is now waiting for the ELK cache check
    let closeError: unknown = null;
    await runner.close().catch((error) => { closeError = error; });
    assert.equal(closeError, null, `close() rejected: ${closeError}`);
    const settled = await within(call);
    assert.notEqual(settled, "pending", "the accepted call never settled after close");
    await quietPeriod();
    assert.equal(starts(), 0, "a worker started after close");
  });

  it("settles queued calls on close and starts none of them", async () => {
    const { runner, starts } = setup();
    const calls = [runner.run(args), runner.run(args), runner.run(args)];
    await runner.close().catch(() => {});
    const settled = await within(Promise.all(calls));
    assert.notEqual(settled, "pending", "queued calls never settled after close");
    await quietPeriod();
    assert.equal(starts(), 0);
  });

  it("does not start a worker for a call made after close, and settles it", async () => {
    const { runner, starts } = setup();
    await runner.close();
    const settled: any = await within(runner.run(args));
    assert.notEqual(settled, "pending", "a call after close never settled");
    await quietPeriod();
    assert.equal(starts(), 0, "a worker started for a call after close");
  });

  it("closes while a worker is running: the call settles, close resolves twice, no new worker", async () => {
    const { runner, starts } = setup(path.join(ROOT, "tests/fixtures/toolserver/slow-worker.mjs"));
    const call = runner.run(args);
    const deadline = Date.now() + 5000;
    while (starts() === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.equal(starts(), 1, "the slow worker never started");
    await runner.close();
    await runner.close();
    const settled: any = await within(call);
    assert.notEqual(settled, "pending", "the running call never settled after close");
    assert.equal(settled.isError, true);
    await quietPeriod();
    assert.equal(starts(), 1, "another worker started after close");
  });

  it("settles a call whose worker cannot start instead of hanging", async () => {
    const { runner } = setup(path.join(scratch, "missing-worker.mjs"));
    const settled: any = await within(runner.run(args));
    assert.notEqual(settled, "pending", "a failed worker start left the call pending");
    assert.equal(settled.isError, true);
  });
});
