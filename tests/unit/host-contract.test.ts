import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TIMELINE_KINDS } from "../../shared/contracts";

// Paseo 0.15.0 web client rejects the whole client plugin when a renderer kind fails this
// pattern ("Invalid timeline renderer kind"), so every kind must satisfy it.
const HOST_KIND = /^[a-z][a-z0-9-]*$/;

describe("Paseo host registration constraints", () => {
  it("uses timeline renderer kinds the host accepts", () => {
    for (const kind of Object.values(TIMELINE_KINDS)) assert.match(kind, HOST_KIND);
  });

  it("uses distinct timeline renderer kinds", () => {
    const kinds = Object.values(TIMELINE_KINDS);
    assert.equal(new Set(kinds).size, kinds.length);
  });
});
