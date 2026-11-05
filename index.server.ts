import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { prepareSourceRpc, viewerAssetRpc } from "./shared/contracts";
import type { PluginDirectoryEntry } from "./server/plugin-root";
import { createToolServerInjector } from "./server/toolserver";
import { readViewerAsset } from "./server/viewer-asset";
import { createXmlSourceLoader } from "./server/xml-source-loader";

async function daemonPluginEntries(paseo: PluginHookContext["paseo"]): Promise<PluginDirectoryEntry[]> {
  const { config } = await paseo.config.get();
  return Object.entries(config.plugins ?? {}).map(([id, entry]) => ({ id, path: entry.path, enabled: entry.enabled }));
}

export default function contribute(server: PluginServerContext) {
  server.handle(viewerAssetRpc, () => readViewerAsset());

  const prepareSource = createXmlSourceLoader();
  server.handle(prepareSourceRpc, ({ xml }, { paseo }) => prepareSource(xml, () => daemonPluginEntries(paseo)));

  const inject = createToolServerInjector({});
  const removeHook = server.addHook("agent.open.before", ({ request }, { paseo }) =>
    inject(request, () => daemonPluginEntries(paseo)),
  );

  return () => {
    removeHook();
  };
}
