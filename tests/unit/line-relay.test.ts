import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLineRelay } from "../../server/launcher/drawio-toolserver.mjs";

const MiB = 1024 * 1024;
// The MCP SDK stdio transport refuses messages above 10 MiB; the relay must not hold or
// forward more than that for a single line either.
const LIMIT = 10 * MiB;

function relay() {
  const lines: string[] = [];
  const errors: unknown[] = [];
  const r = createLineRelay((line: string) => lines.push(line));
  const push = (chunk: string) => {
    r.push(chunk);
  };
  return { r, lines, errors, push };
}

describe("launcher line relay", () => {
  it("reassembles lines split across chunks and splits several lines in one chunk", () => {
    const { lines, push } = relay();
    push('{"a":');
    push('1}\n{"b":2}\n{"c"');
    push(":3}\n");
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("does not accumulate or forward a line beyond 10 MiB, and recovers for the next line", () => {
    const { lines, push } = relay();
    const chunk = "x".repeat(MiB);
    for (let i = 0; i < 12; i += 1) push(chunk);
    push("\n");
    push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    const oversized = lines.filter((line) => line.length > LIMIT);
    assert.equal(oversized.length, 0, `forwarded a ${Math.max(...lines.map((l) => l.length))}-char line`);
    assert.equal(lines.at(-1), '{"jsonrpc":"2.0","id":1,"method":"ping"}', "the next ordinary line must still be framed");
  });

  it("bounds lines by UTF-8 bytes, not characters, for multibyte content", () => {
    const { lines, push } = relay();
    const chunk = "图".repeat(256 * 1024); // 768 KiB per chunk in UTF-8
    for (let i = 0; i < 14; i += 1) push(chunk); // 3.5 M characters, 10.5 MiB
    push("\n");
    push('{"jsonrpc":"2.0","id":2,"method":"ping","params":{"t":"图"}}\n');
    const tooBig = lines.filter((line) => Buffer.byteLength(line) > LIMIT);
    assert.equal(tooBig.length, 0, `forwarded a ${Math.max(...lines.map((l) => Buffer.byteLength(l)))}-byte line`);
    assert.equal(lines.at(-1), '{"jsonrpc":"2.0","id":2,"method":"ping","params":{"t":"图"}}');
  });

});
