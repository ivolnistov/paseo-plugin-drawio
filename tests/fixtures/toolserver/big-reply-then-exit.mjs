// Stand-in Tool Server that answers the first request with one large JSON-RPC result
// and exits as soon as its own stdout has flushed.
import { createInterface } from "node:readline";
const size = Number(process.env.S1_REPLY_BYTES ?? 3 * 1024 * 1024);
createInterface({ input: process.stdin }).once("line", (line) => {
  const { id } = JSON.parse(line);
  const reply = JSON.stringify({ jsonrpc: "2.0", id, result: { pad: "x".repeat(size) } }) + "\n";
  process.stdout.write(reply, () => process.exit(0));
});
