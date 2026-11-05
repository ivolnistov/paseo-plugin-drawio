import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { DEFAULT_PLUGIN_ID, PLUGIN_PACKAGE_NAME, TOOL_SERVER_PACKAGE, TOOL_SERVER_VERSION } from "../shared/constants";

export interface PluginDirectoryEntry {
  id: string;
  path: string;
  enabled?: boolean;
}

export type ReadPackageName = (directory: string) => string | null;

export function readPackageName(directory: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as { name?: unknown };
    return typeof manifest.name === "string" ? manifest.name : null;
  } catch {
    return null;
  }
}

/**
 * Picks this plugin's directory from the daemon's plugin entries. The default install id wins;
 * otherwise the single enabled entry whose package is this plugin. Ambiguity returns null.
 */
export function selectPluginRoot(
  entries: readonly PluginDirectoryEntry[],
  packageNameOf: ReadPackageName = readPackageName,
): string | null {
  const ours = entries.filter((entry) => entry.enabled !== false && packageNameOf(entry.path) === PLUGIN_PACKAGE_NAME);
  const preferred = ours.find((entry) => entry.id === DEFAULT_PLUGIN_ID);
  if (preferred) return preferred.path;
  return ours.length === 1 ? ours[0]!.path : null;
}

export interface ToolServerFiles {
  root: string;
  launcherPath: string;
  serverEntry: string;
}

/** Resolves the pinned Tool Server and the launcher from a plugin directory, or explains why not. */
export function resolveToolServerFiles(root: string): ToolServerFiles | { error: string } {
  const launcherPath = path.join(root, "server", "launcher", "drawio-toolserver.mjs");
  if (!existsSync(launcherPath)) return { error: `launcher missing at ${launcherPath}` };
  let manifestPath: string;
  try {
    manifestPath = createRequire(path.join(root, "package.json")).resolve(`${TOOL_SERVER_PACKAGE}/package.json`);
  } catch {
    return { error: `${TOOL_SERVER_PACKAGE} is not installed for ${root}` };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string; bin?: Record<string, string> };
  if (manifest.version !== TOOL_SERVER_VERSION) {
    return { error: `${TOOL_SERVER_PACKAGE} ${manifest.version ?? "unknown"} found, ${TOOL_SERVER_VERSION} required` };
  }
  const bin = manifest.bin?.["drawio-mcp"];
  if (!bin) return { error: `${TOOL_SERVER_PACKAGE} declares no drawio-mcp entry` };
  return { root, launcherPath, serverEntry: path.resolve(path.dirname(manifestPath), bin) };
}
