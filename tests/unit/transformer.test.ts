import assert from "node:assert/strict";
import { describe, it } from "node:test";
import contribute from "../../index.client.tsx";

type Transform = (input: { item: { type: "assistant_message"; text: string; messageId?: string }; phase: "streaming" | "complete" }) =>
  { items: Array<{ id: string; kind: string }> } | undefined;

function registeredTransformer(): Transform {
  let transform: Transform | null = null;
  const noop = () => () => {};
  contribute({
    addFilePanel: noop,
    addTimelineRenderer: noop,
    addSlashCommand: noop,
    addTimelineTransformer: (c: { transform: Transform }) => { transform = c.transform; return () => {}; },
  } as never);
  assert.ok(transform, "client entry registers a timeline transformer");
  return transform!;
}

const fenced = (label: string) =>
  `${label} prose.\n\n\`\`\`drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="v" value="${label}" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>\n\`\`\`\n\nEnd ${label}.`;
const message = (messageId: string, text: string) => ({ type: "assistant_message" as const, text, messageId });

// Paseo renders transformer output by item id; two assistant messages in one agent that
// emit the same ids show the later message in place of the earlier one.
describe("registered timeline transformer across assistant messages", () => {
  const transform = registeredTransformer();

  it("gives two different assistant messages disjoint item ids", () => {
    const first = transform({ item: message("msg-a", fenced("first")), phase: "complete" })!.items.map((i) => i.id);
    const second = transform({ item: message("msg-b", fenced("second")), phase: "complete" })!.items.map((i) => i.id);
    const shared = first.filter((id) => second.includes(id));
    assert.deepEqual(shared, [], `ids shared across messages: ${shared.join(", ")}`);
  });

  it("keeps a message's ids stable from streaming to completion and on refetch", () => {
    const text = fenced("stable");
    const partial = text.slice(0, text.lastIndexOf("```"));
    const streamed = transform({ item: message("msg-s", partial), phase: "streaming" })!.items;
    assert.ok(streamed.some((i: { kind: string }) => i.kind === "drawio-pending"), "streaming input must leave the fence open");
    const streaming = streamed.map((i: { id?: string }) => i.id);
    const complete = transform({ item: message("msg-s", text), phase: "complete" })!.items.map((i) => i.id);
    const refetch = transform({ item: message("msg-s", text), phase: "complete" })!.items.map((i) => i.id);
    for (const id of streaming) assert.ok(complete.includes(id), `streaming id ${id} vanished at completion`);
    assert.deepEqual(refetch, complete);
  });
});
