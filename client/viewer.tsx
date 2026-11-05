import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { MAX_DIAGRAM_CHARS, VIEWER_VERSION } from "../shared/constants";
import { prepareSourceRpc, viewerAssetRpc } from "../shared/contracts";
import { classifyDiagramXml, hasDoctype, type DiagramCheck } from "../shared/diagram";
import { frameBudget } from "./frame-budget";
import { isDarkTheme } from "./theme";
import { mountFrame, type FrameEvent } from "./web";

/** The pinned viewer, fetched once per client session and kept for its lifetime. */
export function useViewerAsset() {
  const getAsset = useRpc(viewerAssetRpc);
  return useQuery({
    queryKey: ["drawio-viewer", VIEWER_VERSION],
    queryFn: () => getAsset({}),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

export interface DrawioViewerProps {
  xml: string;
  theme: PluginTheme;
  compact: boolean;
  /** File tabs fill their panel and keep their frame; inline rows size to content and can be paused. */
  variant: "panel" | "inline";
  /** A classification of `xml` the caller already made, so the source is not inspected twice. */
  check?: DiagramCheck;
}

type RenderState = { status: "rendering" } | { status: "rendered"; pages: number } | { status: "error"; message: string };

export function DrawioViewer(props: DrawioViewerProps) {
  // The platform is fixed for the app's lifetime, so this branch never changes the hook order.
  if (Platform.OS !== "web") return <NativeNotice theme={props.theme} xml={props.xml} />;
  return <CheckedViewer {...props} />;
}

const formatCount = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function CheckedViewer(props: DrawioViewerProps) {
  // A DTD is never handed to the browser: the daemon expands it into canonical XML first.
  if (props.xml.length <= MAX_DIAGRAM_CHARS && hasDoctype(props.xml)) return <PreparedViewer {...props} check={undefined} />;
  return <ClassifiedViewer {...props} />;
}

type Prepared = { status: "pending" } | RpcOutput<typeof prepareSourceRpc>;

function PreparedViewer({ xml, theme, compact, variant }: DrawioViewerProps) {
  const prepareSource = useRpc(prepareSourceRpc);
  const prepareRef = useRef(prepareSource);
  prepareRef.current = prepareSource;
  const [prepared, setPrepared] = useState<Prepared>({ status: "pending" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setPrepared({ status: "pending" });
    prepareRef.current({ xml }).then(
      (result) => current && setPrepared(result),
      (error: unknown) =>
        current &&
        setPrepared({ status: "error", code: "unavailable", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [xml, attempt]);

  if (prepared.status === "pending") return <Notice theme={theme} tone="muted" text="Preparing the diagram…" />;
  if (prepared.status === "error") {
    return (
      <Notice theme={theme} tone="danger" text={prepared.message}>
        {prepared.code === "unavailable" ? <Action theme={theme} label="Try again" onPress={() => setAttempt((n) => n + 1)} /> : null}
      </Notice>
    );
  }
  return <ClassifiedViewer xml={prepared.xml} theme={theme} compact={compact} variant={variant} />;
}

function ClassifiedViewer({ xml, theme, compact, variant, check: given }: DrawioViewerProps) {
  const check = useMemo(() => given ?? classifyDiagramXml(xml), [given, xml]);
  if (check.status === "empty") return <Notice theme={theme} tone="muted" text="This diagram is empty." />;
  if (check.status === "not-drawio") {
    return <Notice theme={theme} tone="danger" text="This is not draw.io XML. Expected <mxfile> or <mxGraphModel>." />;
  }
  if (check.status === "too-large") {
    const text = check.expanded
      ? `This diagram is too large to show here: its compressed pages expand beyond the limit of ${formatCount(check.limit)} bytes.`
      : `This diagram is too large to show here (${formatCount(check.chars)} characters, limit ${formatCount(check.limit)} characters).`;
    return <Notice theme={theme} tone="danger" text={text} />;
  }
  return <WebViewer xml={xml} theme={theme} compact={compact} variant={variant} />;
}

function WebViewer({ xml, theme, compact, variant }: DrawioViewerProps) {
  const asset = useViewerAsset();
  const frameId = useId();
  const pinned = variant === "panel";
  // "refused": the live-frame limit is held by file tabs, which are never paused.
  const [frame, setFrame] = useState<"pending" | "active" | "evicted" | "refused">("pending");
  const [render, setRender] = useState<RenderState>({ status: "rendering" });
  const hostRef = useRef<View>(null);
  const dark = isDarkTheme(theme);
  const source = asset.data?.source;

  const claim = () =>
    setFrame(frameBudget.acquire(frameId, { pinned, onEvict: () => setFrame("evicted") }) ? "active" : "refused");

  useEffect(() => {
    claim();
    return () => frameBudget.release(frameId);
  }, [frameId, pinned]);

  useEffect(() => {
    if (frame !== "active" || !source) return;
    setRender({ status: "rendering" });
    return mountFrame(hostRef.current, {
      viewerSource: source,
      xml,
      dark,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      fill: variant === "panel",
      minHeight: compact ? 160 : 200,
      maxHeight: compact ? 480 : 720,
      onEvent(event: FrameEvent) {
        if (event.type === "rendered") {
          setRender({ status: "rendered", pages: event.pages });
          frameBudget.touch(frameId);
        } else if (event.type === "error") {
          setRender({ status: "error", message: event.message });
        }
      },
    });
  }, [frame, source, xml, dark, theme.colors.surface0, theme.colors.foreground, variant, compact, frameId]);

  if (asset.isPending) return <Notice theme={theme} tone="muted" text="Loading the draw.io viewer…" />;
  if (asset.isError) {
    return (
      <Notice theme={theme} tone="danger" text={`The draw.io viewer could not be loaded: ${asset.error.message}`}>
        <Action theme={theme} label="Try again" onPress={() => void asset.refetch()} />
      </Notice>
    );
  }
  if (frame === "evicted") {
    return (
      <Notice theme={theme} tone="muted" text="Diagram paused to limit memory use.">
        <Action theme={theme} label="Show diagram" onPress={claim} />
      </Notice>
    );
  }
  if (frame === "refused") {
    return (
      <Notice theme={theme} tone="muted" text="Too many draw.io file tabs are open to show this diagram. Close one, then try again.">
        <Action theme={theme} label="Try again" onPress={claim} />
      </Notice>
    );
  }
  return (
    <View style={{ flex: variant === "panel" ? 1 : undefined, gap: 4 }}>
      {render.status === "error" ? <Notice theme={theme} tone="danger" text={render.message} /> : null}
      {render.status === "rendering" ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Rendering diagram…</Text>
      ) : null}
      <View
        ref={hostRef}
        style={{
          flex: variant === "panel" ? 1 : undefined,
          minHeight: variant === "panel" ? 0 : compact ? 160 : 200,
          borderRadius: 6,
          borderWidth: variant === "inline" ? 1 : 0,
          borderColor: theme.colors.border,
          overflow: "hidden",
          backgroundColor: theme.colors.surface0,
        }}
      />
    </View>
  );
}

function NativeNotice({ theme, xml }: { theme: PluginTheme; xml: string }) {
  return (
    <Notice
      theme={theme}
      tone="muted"
      text={`draw.io diagram (${formatCount(xml.length)} characters). Interactive rendering needs the desktop app or a web browser; this client cannot run the draw.io viewer yet.`}
    />
  );
}

export function Notice({
  theme,
  tone,
  text,
  children,
}: {
  theme: PluginTheme;
  tone: "muted" | "danger";
  text: string;
  children?: ReactNode;
}) {
  return (
    <View
      style={{
        padding: 10,
        gap: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: tone === "danger" ? theme.colors.statusDanger : theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Text style={{ color: tone === "danger" ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 13 }}>
        {text}
      </Text>
      {children}
    </View>
  );
}

export function Action({ theme, label, onPress }: { theme: PluginTheme; label: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
      }}
    >
      <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
