import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RpcOutput } from "@getpaseo/plugin";
import type { prepareSourceRpc } from "../shared/contracts";
import type { PluginDirectoryEntry } from "./plugin-root";
import { selectPluginRoot } from "./plugin-root";

type PrepareResult = RpcOutput<typeof prepareSourceRpc>;
interface XmlSourceModule {
  prepareDiagramXml(xml: string): Promise<PrepareResult>;
}

const unavailable = (message: string): PrepareResult => ({ status: "error", code: "unavailable", message });

/**
 * Loads server/xml-source.mjs from this plugin's directory at run time. It cannot be bundled:
 * its XML parser is an ES module with top-level await and inline WebAssembly.
 */
export function createXmlSourceLoader(importModule: (url: string) => Promise<unknown> = (url) => import(url)) {
  let loading: Promise<XmlSourceModule> | null = null;

  async function load(loadEntries: () => Promise<PluginDirectoryEntry[]>): Promise<XmlSourceModule> {
    const root = selectPluginRoot(await loadEntries());
    if (!root) throw new Error("this plugin's directory was not found in the daemon plugin list");
    return (await importModule(pathToFileURL(path.join(root, "server", "xml-source.mjs")).href)) as XmlSourceModule;
  }

  return async function prepare(xml: string, loadEntries: () => Promise<PluginDirectoryEntry[]>): Promise<PrepareResult> {
    try {
      loading ??= load(loadEntries).catch((error: unknown) => {
        loading = null;
        throw error;
      });
      return await (await loading).prepareDiagramXml(xml);
    } catch (error) {
      console.warn(`[drawio] XML source preparation unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return unavailable("The daemon could not prepare this diagram; try again.");
    }
  };
}
