// The prepare_drawio_xml tool: runs the official draw.io XML passes and returns the XML.
// Pure helpers for the launcher; nothing here starts a process or a worker.

export const PREPARE_TOOL_NAME = "prepare_drawio_xml";
export const MAX_PREPARE_INPUT_CHARS = 2_000_000;
export const MAX_PREPARE_OUTPUT_CHARS = 8_000_000;

const POST_LAYOUT_VALUES = Object.freeze(["elk"]);
const DIRECTION_VALUES = Object.freeze(["vertical", "horizontal"]);
const ROUTING_VALUES = Object.freeze(["libavoid"]);

const CONTRACT =
  "Repairs, normalizes and optionally lays out draw.io XML with the official draw.io engine and " +
  "returns the resulting XML. It does not open anything and does not write files in the workspace " +
  "(edge routing only updates the plugin's own cache of the official routing library): save the " +
  "result to a .drawio file or reply with it in a drawio fence.";

const PASEO_NOTE =
  "In Paseo, open_drawio_xml, open_drawio_mermaid and open_drawio_csv are not available: write " +
  "draw.io XML and pass postLayout or routing to this tool instead. content must contain XML and " +
  `may have up to ${MAX_PREPARE_INPUT_CHARS} characters. A result may have up to ${MAX_PREPARE_OUTPUT_CHARS} ` +
  "characters and its reply up to 10 MiB of UTF-8; larger results are refused. Paseo only renders a " +
  `diagram up to ${MAX_PREPARE_INPUT_CHARS} characters, so split a larger diagram into separate .drawio ` +
  "files, each under that size.";

const FALLBACK_GUIDANCE =
  "Pass a complete <mxGraphModel> (or <mxfile>). Set postLayout \"elk\" for flowcharts, process and " +
  "tree diagrams; ELK places the vertices and routes the edges.";

function describeOption(description, fallback) {
  if (typeof description !== "string") return fallback;
  return description.replace(/ before the diagram opens/g, " before the XML is returned");
}

/** The tool definition, derived from the official open_drawio_xml entry when it is available. */
export function buildPrepareTool(official) {
  const officialDescription = typeof official?.description === "string" ? official.description : "";
  const firstStop = officialDescription.indexOf(".");
  const guidance = firstStop >= 0 ? officialDescription.slice(firstStop + 1).trim() : "";
  const properties = official?.inputSchema?.properties ?? {};
  return {
    name: PREPARE_TOOL_NAME,
    description: `${CONTRACT}\n\n${guidance || FALLBACK_GUIDANCE}\n\n${PASEO_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          minLength: 1,
          maxLength: MAX_PREPARE_INPUT_CHARS,
          description: `${describeOption(properties.content?.description, "The draw.io XML content in mxGraphModel format.")} Must not be empty or only whitespace.`,
        },
        postLayout: {
          type: "string",
          enum: Array.isArray(properties.postLayout?.enum) ? properties.postLayout.enum : [...POST_LAYOUT_VALUES],
          description: `${describeOption(properties.postLayout?.description, "Optional ELK layered layout. The only value is \"elk\".")} In Paseo, ELK runs only when its bundle has been prepared on the daemon; otherwise it is skipped with a note and the other passes still run.`,
        },
        direction: {
          type: "string",
          enum: Array.isArray(properties.direction?.enum) ? properties.direction.enum : [...DIRECTION_VALUES],
          description: `${describeOption(
            properties.direction?.description,
            "Flow direction for postLayout \"elk\": \"vertical\" (default) or \"horizontal\".",
          )} Requires postLayout "elk"; refused without it.`,
        },
        routing: {
          type: "string",
          enum: Array.isArray(properties.routing?.enum) ? properties.routing.enum : [...ROUTING_VALUES],
          description: describeOption(
            properties.routing?.description,
            "Optional obstacle-avoiding orthogonal edge routing (libavoid). The only value is \"libavoid\".",
          ),
        },
      },
      required: ["content"],
    },
  };
}

/**
 * Checks tool arguments. Returns { ok: true, value } or { ok: false, error } naming the field.
 * Properties the tool does not define are ignored.
 */
export function validatePrepareArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "Arguments must be an object with a content string." };
  }
  const { content, postLayout, direction, routing } = args;
  if (typeof content !== "string") {
    return { ok: false, error: `content must be a string of draw.io XML, not ${content === undefined ? "missing" : typeof content}.` };
  }
  if (content.trim().length === 0) return { ok: false, error: "content is empty." };
  if (content.length > MAX_PREPARE_INPUT_CHARS) {
    return { ok: false, error: `content has ${content.length} characters; the limit is ${MAX_PREPARE_INPUT_CHARS}.` };
  }
  if (postLayout !== undefined && !POST_LAYOUT_VALUES.includes(postLayout)) {
    return { ok: false, error: `postLayout must be one of: ${POST_LAYOUT_VALUES.join(", ")}.` };
  }
  if (direction !== undefined) {
    if (!DIRECTION_VALUES.includes(direction)) {
      return { ok: false, error: `direction must be one of: ${DIRECTION_VALUES.join(", ")}.` };
    }
    if (postLayout === undefined) return { ok: false, error: "direction only applies together with postLayout \"elk\"." };
  }
  if (routing !== undefined && !ROUTING_VALUES.includes(routing)) {
    return { ok: false, error: `routing must be one of: ${ROUTING_VALUES.join(", ")}.` };
  }
  return { ok: true, value: { content, postLayout, direction, routing } };
}

/** The tool result: the XML first, then a notes block only when there are notes. */
export function formatPrepareResult({ xml, notes }) {
  if (typeof xml !== "string") return formatPrepareError("The draw.io passes returned no XML.");
  if (xml.length > MAX_PREPARE_OUTPUT_CHARS) {
    return formatPrepareError(
      `The prepared XML has ${xml.length} characters, over the ${MAX_PREPARE_OUTPUT_CHARS}-character limit; nothing was returned.`,
    );
  }
  const content = [{ type: "text", text: xml }];
  if (Array.isArray(notes) && notes.length > 0) content.push({ type: "text", text: `Notes:\n- ${notes.join("\n- ")}` });
  return { content };
}

export function formatPrepareError(message) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
