import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DrawioFilePanel } from "./client/file-panel";
import { DiagramRow, PendingRow, TextRow } from "./client/timeline";
import {
  TIMELINE_KINDS,
  TIMELINE_VERSION,
  diagramItemSchema,
  pendingItemSchema,
  textItemSchema,
} from "./shared/contracts";
import { scopeTimelineItems, splitDrawioFences, toTimelineItems } from "./shared/fences";
import { buildDrawioPrompt } from "./shared/prompt";

const MAX_ECHOED_REQUEST = 300;

/** The host clears the composer first, so the refusal repeats the request for the user to copy. */
function busyRefusal(args: string): string {
  const request = args.trim();
  const base = "The agent is busy, so /drawio was not sent. Run it again when the turn has finished.";
  if (!request) return base;
  const shown = request.length > MAX_ECHOED_REQUEST ? `${request.slice(0, MAX_ECHOED_REQUEST)}…` : request;
  return `${base} Your request: /drawio ${shown}`;
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addFilePanel({
      id: "drawio-viewer",
      title: "draw.io",
      icon: "Workflow",
      files: { extensions: ["drawio"] },
      Component: DrawioFilePanel,
    }),
    client.addTimelineTransformer({
      id: "drawio-fences",
      query: { itemType: "assistant_message" },
      transform({ item, phase }) {
        const segments = splitDrawioFences(item.text, phase);
        if (!segments) return undefined;
        return { items: scopeTimelineItems(toTimelineItems(segments, phase), item.messageId) };
      },
    }),
    client.addTimelineRenderer({ kind: TIMELINE_KINDS.text, version: TIMELINE_VERSION, schema: textItemSchema, Component: TextRow }),
    client.addTimelineRenderer({
      kind: TIMELINE_KINDS.diagram,
      version: TIMELINE_VERSION,
      schema: diagramItemSchema,
      Component: DiagramRow,
    }),
    client.addTimelineRenderer({
      kind: TIMELINE_KINDS.pending,
      version: TIMELINE_VERSION,
      schema: pendingItemSchema,
      Component: PendingRow,
    }),
    client.addSlashCommand({
      name: "drawio",
      description: "Ask this agent for a draw.io diagram",
      argumentHint: "[what to draw]",
      context: "agent",
      async onSubmit({ args, agent, paseo }) {
        // Sending to a busy agent would interrupt its turn; steering can also replace it.
        if (agent.status === "running") throw new Error(busyRefusal(args));
        await paseo.agents.ref(agent.id).send(buildDrawioPrompt(args));
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
