// The official draw.io ELK layout bundle is not shipped with the plugin. An explicit preparation
// step downloads it once into the private per-user cache and keeps it only if it matches the
// pinned SHA-256; layouts then read the verified local file, with no network check.
import { createHash, randomBytes } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ensurePrivateDirectory, isPrivateFile, PREPARE_CACHE_HOME } from "./user-cache.mjs";

export const ELK_BUNDLE_SHA256 = "25847b1ded5d2fed2e175ec0d781d6e36b6d2971d29d3959c6aac70ddfedd394";
export const ELK_BUNDLE_BYTES = 923_334;
/** The bundle as published in the draw.io v32.6.10 release tag. */
export const ELK_BUNDLE_URL = "https://raw.githubusercontent.com/jgraph/drawio/v32.6.10/src/main/webapp/js/elk/drawio-elk.min.js";
export const ELK_DOWNLOAD_TIMEOUT_MS = 60_000;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function elkBundlePath(cacheHome = PREPARE_CACHE_HOME) {
  return path.join(cacheHome, "elk", "drawio-elk.min.js");
}

/** The bundle path when the cached file is private and matches the pin, else null. Never downloads. */
export async function verifiedElkBundle(cacheHome = PREPARE_CACHE_HOME) {
  const file = elkBundlePath(cacheHome);
  try {
    const stat = await lstat(file);
    if (!isPrivateFile(stat) || stat.size !== ELK_BUNDLE_BYTES) return null;
    return sha256(await readFile(file)) === ELK_BUNDLE_SHA256 ? file : null;
  } catch {
    return null;
  }
}

/** Reads the response body, stopping once it is longer than the pinned bundle. */
async function readBounded(response) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    chunks.push(chunk);
    if (total > ELK_BUNDLE_BYTES) break;
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/**
 * Makes sure a verified bundle is in the cache, downloading it when missing, invalid, or `force`.
 * A failed or mismatching download never replaces a verified copy; on error, `path` names the
 * verified copy that was kept, if any.
 */
export async function prepareElkBundle({ cacheHome = PREPARE_CACHE_HOME, url = ELK_BUNDLE_URL, force = false, timeoutMs = ELK_DOWNLOAD_TIMEOUT_MS } = {}) {
  const existing = await verifiedElkBundle(cacheHome);
  if (existing && !force) return { status: "ok", path: existing, downloaded: false };
  // The cache is checked again when a failure is reported: another preparation may have stored,
  // or something may have damaged, a verified copy while this download ran.
  const failed = async (code, message) => ({ status: "error", code, message, path: await verifiedElkBundle(cacheHome) });

  let bytes;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    if (!response.ok || !response.body) return await failed("download-failed", `downloading ${url} returned HTTP ${response.status}.`);
    bytes = await readBounded(response);
  } catch (error) {
    return await failed("download-failed", `downloading ${url} failed: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (bytes.length < ELK_BUNDLE_BYTES) {
    // A body that ends early, even without a transport error, is an incomplete transfer.
    return await failed("download-failed", `the download from ${url} ended after ${bytes.length} of ${ELK_BUNDLE_BYTES} bytes.`);
  }
  if (bytes.length !== ELK_BUNDLE_BYTES || sha256(bytes) !== ELK_BUNDLE_SHA256) {
    return await failed("hash-mismatch", `the file from ${url} does not match the pinned SHA-256 ${ELK_BUNDLE_SHA256}; it was not used.`);
  }

  const target = elkBundlePath(cacheHome);
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    ensurePrivateDirectory(cacheHome);
    ensurePrivateDirectory(path.dirname(target));
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    return await failed("download-failed", `storing the verified bundle failed: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const verified = await verifiedElkBundle(cacheHome);
  return verified ? { status: "ok", path: verified, downloaded: true } : await failed("download-failed", "the stored bundle could not be verified.");
}
