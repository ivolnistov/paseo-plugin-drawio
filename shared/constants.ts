export const PLUGIN_PACKAGE_NAME = "paseo-plugin-drawio";
export const DEFAULT_PLUGIN_ID = "drawio";

export const VIEWER_VERSION = "32.6.10";
export const VIEWER_SHA256 = "dfa1cfb4ef24320b67131405da88511e7baba48621ddd5260eea8ec5f6425928";

export const TOOL_SERVER_PACKAGE = "@drawio/mcp";
export const TOOL_SERVER_VERSION = "1.10.1";
export const MCP_SERVER_KEY = "paseo-drawio";

/** Largest diagram source the viewer is asked to render, in UTF-16 code units. */
export const MAX_DIAGRAM_CHARS = 2_000_000;

/**
 * Largest total size of the diagram once compressed pages are expanded, in bytes of the inflated
 * page data. Checked before the viewer decompresses anything.
 */
export const MAX_EXPANDED_BYTES = 8_000_000;
