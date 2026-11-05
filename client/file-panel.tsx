import type { PluginFilePanelProps } from "@getpaseo/plugin/client";
import { PluginFileDeletedError, useFileText } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Platform, Text, View } from "react-native";
import { classifyDiagramXml, hasDoctype } from "../shared/diagram";
import { DrawioViewer, Notice } from "./viewer";

/** Read-only view of a .drawio file. Paseo re-reads the text when the file changes on disk. */
export function DrawioFilePanel({ file, theme, layout }: PluginFilePanelProps) {
  const text = useFileText(file);
  const padding = layout.compact ? 8 : 12;
  // Native clients only show a notice, so they skip inspecting (and inflating) the source.
  // A source with a DOCTYPE is classified by the viewer after the daemon has expanded it.
  const check = useMemo(
    () =>
      text.status === "ready" && Platform.OS === "web" && !hasDoctype(text.text) ? classifyDiagramXml(text.text) : null,
    [text],
  );
  const pages = check?.status === "ok" ? (check.pages === 1 ? "1 page · " : `${check.pages} pages · `) : "";

  if (text.status === "loading") return <Loading />;

  return (
    <View style={{ flex: 1, padding, gap: 8, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
        {text.status === "ready" ? `${file.name} · ${pages}read-only` : file.name}
      </Text>
      {text.status === "error" ? (
        <Notice
          theme={theme}
          tone="danger"
          text={
            text.error instanceof PluginFileDeletedError
              ? "This file was deleted. The tab updates if it is created again."
              : `The file could not be read: ${text.error.message}`
          }
        />
      ) : (
        <DrawioViewer xml={text.text} theme={theme} compact={layout.compact} variant="panel" check={check ?? undefined} />
      )}
    </View>
  );
}
