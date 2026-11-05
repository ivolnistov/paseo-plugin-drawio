import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { diagramItemSchema, pendingItemSchema, textItemSchema } from "../shared/contracts";
import { DrawioViewer } from "./viewer";

export function TextRow({ item }: PluginTimelineItemProps<z.output<typeof textItemSchema>>) {
  return <Markdown>{item.data.text}</Markdown>;
}

export function DiagramRow({ item, theme, layout }: PluginTimelineItemProps<z.output<typeof diagramItemSchema>>) {
  return (
    <View style={{ paddingVertical: 4 }}>
      <DrawioViewer xml={item.data.xml} theme={theme} compact={layout.compact} variant="inline" />
    </View>
  );
}

export function PendingRow({ item, theme }: PluginTimelineItemProps<z.output<typeof pendingItemSchema>>) {
  const size = item.data.chars > 0 ? ` (${item.data.chars} characters so far)` : "";
  return (
    <View
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{`Receiving draw.io diagram…${size}`}</Text>
    </View>
  );
}
