import { createHash } from "node:crypto";
import type { RpcOutput } from "@getpaseo/plugin";
import { VIEWER_SHA256, VIEWER_VERSION } from "../shared/constants";
import type { viewerAssetRpc } from "../shared/contracts";
import viewerSource from "./assets/viewer-static.min.js.txt";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function verifyViewerSource(source: string, expected: string = VIEWER_SHA256): void {
  const actual = sha256Hex(source);
  if (actual !== expected) {
    throw new Error(`draw.io viewer asset failed its integrity check (sha256 ${actual}, expected ${expected})`);
  }
}

let verified: RpcOutput<typeof viewerAssetRpc> | null = null;

/** The pinned official GraphViewer, checked once per plugin process and then served as is. */
export function readViewerAsset(): RpcOutput<typeof viewerAssetRpc> {
  if (!verified) {
    verifyViewerSource(viewerSource);
    verified = { version: VIEWER_VERSION, sha256: VIEWER_SHA256, source: viewerSource };
  }
  return verified;
}
