import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FrameBudget, LIVE_FRAME_LIMIT } from "../../client/frame-budget";

function harness(limit: number) {
  const budget = new FrameBudget(limit);
  const evicted: string[] = [];
  const claim = (id: string, pinned = false) => budget.acquire(id, { pinned, onEvict: () => evicted.push(id) });
  return { budget, evicted, claim };
}

describe("live frame budget", () => {
  it("defaults to a small fixed limit", () => {
    assert.ok(LIVE_FRAME_LIMIT >= 1 && LIVE_FRAME_LIMIT <= 8);
  });

  it("evicts the least recently used timeline frame exactly once when over capacity", () => {
    const { budget, evicted, claim } = harness(3);
    for (const id of ["a", "b", "c"]) assert.equal(claim(id), true);
    budget.touch("a");
    assert.equal(claim("d"), true);
    assert.deepEqual(evicted, ["b"]);
    assert.equal(budget.size, 3);
    assert.equal(budget.has("b"), false);
  });

  it("never evicts pinned file-tab frames and denies a timeline frame when only pinned frames are live", () => {
    const { budget, evicted, claim } = harness(2);
    claim("tab1", true);
    claim("tab2", true);
    assert.equal(claim("row"), false);
    assert.deepEqual(evicted, []);
    assert.equal(budget.has("row"), false);
  });

  it("always grants a pinned frame, evicting timeline frames first", () => {
    const { budget, evicted, claim } = harness(2);
    claim("row1");
    claim("row2");
    assert.equal(claim("tab", true), true);
    assert.deepEqual(evicted, ["row1"]);
    assert.equal(claim("tab2", true), true);
    assert.deepEqual(evicted, ["row1", "row2"]);
    assert.equal(claim("tab3", true), true, "pinned frames may exceed the limit");
    assert.equal(budget.size, 3);
  });

  it("recovers an evicted row by re-acquiring, displacing the next LRU row", () => {
    const { evicted, claim } = harness(2);
    claim("a");
    claim("b");
    claim("c");
    assert.deepEqual(evicted, ["a"]);
    assert.equal(claim("a"), true);
    assert.deepEqual(evicted, ["a", "b"]);
  });

  it("frees capacity on release and tolerates releasing an evicted or unknown frame", () => {
    const { budget, evicted, claim } = harness(1);
    claim("a");
    budget.release("a");
    budget.release("a");
    budget.release("never");
    assert.equal(claim("b"), true);
    assert.deepEqual(evicted, []);
  });

  it("re-acquiring a live id refreshes it without evicting anything", () => {
    const { evicted, claim } = harness(2);
    claim("a");
    claim("b");
    assert.equal(claim("a"), true);
    claim("c");
    assert.deepEqual(evicted, ["b"]);
  });
});
