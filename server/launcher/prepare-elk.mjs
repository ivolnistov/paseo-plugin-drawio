// Downloads and verifies the official ELK layout bundle into the private per-user cache.
// Usage: node server/launcher/prepare-elk.mjs [--force] [--optional]
//   --force     download again even when a verified copy exists
//   --optional  report a failure but exit 0, so a plugin install can complete without ELK
import { prepareElkBundle } from "./elk-bundle.mjs";

const args = new Set(process.argv.slice(2));
const result = await prepareElkBundle({ force: args.has("--force") });
if (result.status === "ok") {
  process.stdout.write(`draw.io ELK bundle ${result.downloaded ? "downloaded and verified" : "already verified"}: ${result.path}\n`);
} else {
  const kept = result.path ? ` The verified copy at ${result.path} is still used.` : " ELK layout stays unavailable until this succeeds.";
  process.stderr.write(`draw.io ELK bundle not prepared (${result.code}): ${result.message}${kept}\n`);
  if (!args.has("--optional")) process.exitCode = 1;
}
