// Pinned official ELK bundle bytes for tests, and a local HTTP server that serves them in
// controlled ways. The bytes are not tracked: they come from S1_ELK_FIXTURE, the ignored copy
// under .validation/s1/fixtures, or the shipped asset while it still exists.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

export const ELK_SHA256 = "25847b1ded5d2fed2e175ec0d781d6e36b6d2971d29d3959c6aac70ddfedd394";
export const ELK_BYTES = 923_334;
const ROOT = path.resolve(import.meta.dirname, "../..");

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export function loadElkFixture(): Buffer | null {
  for (const candidate of [process.env.S1_ELK_FIXTURE, path.join(ROOT, ".validation/s1/fixtures/drawio-elk.min.js"), path.join(ROOT, "server/assets/drawio-elk.min.js")]) {
    if (candidate && existsSync(candidate)) {
      const bytes = readFileSync(candidate);
      if (bytes.length === ELK_BYTES && sha256(bytes) === ELK_SHA256) return bytes;
    }
  }
  return null;
}

export type ServeMode = "good" | "tampered" | "truncated" | "error";

/** Local server for the ELK bundle; `mode` can change between requests; `requests` counts them. */
export async function startElkServer(bytes: Buffer) {
  const state = { mode: "good" as ServeMode, requests: 0 };
  const server: Server = createServer((req, res) => {
    state.requests += 1;
    if (state.mode === "error") { res.writeHead(500); res.end("unavailable"); return; }
    if (state.mode === "tampered") {
      const tampered = Buffer.from(bytes);
      tampered[1000] ^= 0xff;
      res.writeHead(200, { "content-type": "application/javascript", "content-length": tampered.length });
      res.end(tampered);
      return;
    }
    if (state.mode === "truncated") {
      res.writeHead(200, { "content-type": "application/javascript", "content-length": bytes.length });
      res.write(bytes.subarray(0, Math.floor(bytes.length / 2)), () => res.destroy());
      return;
    }
    res.writeHead(200, { "content-type": "application/javascript", "content-length": bytes.length });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    state,
    url: `http://127.0.0.1:${port}/js/elk/drawio-elk.min.js`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
