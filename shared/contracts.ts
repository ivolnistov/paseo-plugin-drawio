import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MAX_DIAGRAM_CHARS } from "./constants";

export const viewerAssetRpc = defineRpc({
  name: "drawio.viewer-asset",
  input: z.object({}),
  output: z.object({
    version: z.string(),
    sha256: z.string(),
    source: z.string(),
  }),
});

export const PREPARE_SOURCE_ERROR_CODES = ["too-large", "external-entity", "invalid-xml", "unavailable"] as const;

/**
 * Turns a source that has a DOCTYPE into canonical XML on the daemon: internal entities expanded
 * under the parser's limits, external ones refused, the DTD removed.
 */
export const prepareSourceRpc = defineRpc({
  name: "drawio.prepare-source",
  input: z.object({ xml: z.string().max(MAX_DIAGRAM_CHARS) }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), xml: z.string().max(MAX_DIAGRAM_CHARS) }),
    z.object({ status: z.literal("error"), code: z.enum(PREPARE_SOURCE_ERROR_CODES), message: z.string() }),
  ]),
});

export const textItemSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

export const diagramItemSchema = z.object({
  xml: z.string(),
  index: z.number().int().nonnegative(),
});

export const pendingItemSchema = z.object({
  index: z.number().int().nonnegative(),
  chars: z.number().int().nonnegative(),
});

/** Renderer kinds must match the host's identifier rule: lowercase letters, digits and hyphens. */
export const TIMELINE_KINDS = {
  text: "drawio-text",
  diagram: "drawio-diagram",
  pending: "drawio-pending",
} as const;
export const TIMELINE_VERSION = 1;
