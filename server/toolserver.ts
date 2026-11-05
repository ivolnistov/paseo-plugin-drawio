import type { PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { MCP_SERVER_KEY } from "../shared/constants";
import { DRAWIO_AGENT_INSTRUCTIONS } from "../shared/prompt";
import { shouldInjectToolServer } from "../shared/providers";
import type { PluginDirectoryEntry, ToolServerFiles } from "./plugin-root";
import { resolveToolServerFiles, selectPluginRoot } from "./plugin-root";

type McpServers = PluginSessionOpenRequest["mcpServers"];
type McpServerEntry = McpServers[string];

/** Environment for the official Tool Server; keeps it from reaching third-party draw.io services. */
export const TOOL_SERVER_ENV: Readonly<Record<string, string>> = {
  DRAWIO_ICON_SERVICE_URL: "off",
  DRAWIO_BASE_URL: "http://127.0.0.1:9/",
  ELECTRON_RUN_AS_NODE: "1",
};

export interface ToolServerEntryInput {
  execPath: string;
  launcherPath: string;
  serverEntry: string;
  cwd: string;
  instructions?: string;
}

export function buildToolServerEntry(input: ToolServerEntryInput): McpServerEntry {
  return {
    type: "stdio",
    command: input.execPath,
    args: [input.launcherPath, input.cwd, input.serverEntry],
    env: { ...TOOL_SERVER_ENV, PASEO_DRAWIO_INSTRUCTIONS: input.instructions ?? DRAWIO_AGENT_INSTRUCTIONS },
  };
}

export type LoadPluginEntries = () => Promise<PluginDirectoryEntry[]>;
export type Log = (message: string) => void;

/**
 * Adds the Tool Server to supported interactive sessions. Any failure to locate it skips
 * injection instead of failing the agent open.
 */
export function createToolServerInjector(options: {
  execPath?: string;
  resolveFiles?: (root: string) => ToolServerFiles | { error: string };
  log?: Log;
}) {
  const resolveFiles = options.resolveFiles ?? resolveToolServerFiles;
  const log = options.log ?? ((message: string) => console.warn(`[drawio] ${message}`));
  let files: ToolServerFiles | null = null;

  async function locate(loadEntries: LoadPluginEntries): Promise<ToolServerFiles | null> {
    if (files) return files;
    const root = selectPluginRoot(await loadEntries());
    if (!root) {
      log("Tool Server not injected: this plugin's directory was not found in the daemon plugin list");
      return null;
    }
    const resolved = resolveFiles(root);
    if ("error" in resolved) {
      log(`Tool Server not injected: ${resolved.error}`);
      return null;
    }
    files = resolved;
    return files;
  }

  return async function inject(
    request: PluginSessionOpenRequest,
    loadEntries: LoadPluginEntries,
  ): Promise<PluginSessionOpenRequest | undefined> {
    if (!shouldInjectToolServer(request)) return undefined;
    let located: ToolServerFiles | null;
    try {
      located = await locate(loadEntries);
    } catch (error) {
      log(`Tool Server not injected: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    if (!located) return undefined;
    const entry = buildToolServerEntry({
      execPath: options.execPath ?? process.execPath,
      launcherPath: located.launcherPath,
      serverEntry: located.serverEntry,
      cwd: request.cwd,
    });
    return { ...request, mcpServers: { ...request.mcpServers, [MCP_SERVER_KEY]: entry } };
  };
}
