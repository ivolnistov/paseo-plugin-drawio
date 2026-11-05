import { MAX_DIAGRAM_CHARS, MAX_EXPANDED_BYTES } from "./constants";

/**
 * The contract agents follow so Paseo can show their diagrams. It describes surfaces only;
 * file names, locations and whether to update an existing file stay the agent's decisions.
 */
export const DRAWIO_AGENT_INSTRUCTIONS = [
  "Paseo shows draw.io diagrams in two ways. Choose per request.",
  "",
  "1. Saved diagram: write a .drawio file in the workspace with your normal file tool, then",
  "   link it in your reply with a relative Markdown link, for example [Architecture](docs/architecture.drawio).",
  "   The user opens the link in a Paseo file tab. To change an existing file, update it in place",
  "   with set_page (one page) or your file tool. If you have the draw.io tools, use list_pages and",
  "   get_page to read large files; otherwise read them with your file tool.",
  "2. One-off snapshot: put the diagram XML in a fenced block whose language is drawio.",
  "   Paseo renders it read-only in the conversation and creates no file.",
  "",
  "Fence content is a complete <mxfile> (one or more <diagram> pages) or a single <mxGraphModel>.",
  "Use one fence per diagram; several fences in one reply are fine. Do not wrap the XML in other markup.",
  "Paths in tool calls are relative to the workspace root.",
  "If the draw.io tools are available to you, prepare_drawio_xml repairs XML, lays it out",
  "automatically or routes its edges and returns the XML without saving it. Without them, write the",
  "XML yourself with your file tool or in a fence.",
  `Paseo does not render a diagram whose source exceeds ${MAX_DIAGRAM_CHARS} characters or whose`,
  `compressed pages expand beyond ${MAX_EXPANDED_BYTES} bytes.`,
  "The viewer works offline: external image URLs and web fonts are not loaded, so embed images",
  "as data: URIs when they matter. Diagram links do not open from the viewer.",
  "Do not send diagrams to external services or open them in a browser.",
].join("\n");

const CLARIFY_REQUEST =
  "The user ran /drawio without describing a diagram. Ask them briefly what they want drawn " +
  "and whether it should be saved as a .drawio file or shown once in the conversation. " +
  "Do not create a diagram until they answer.";

/** Prompt sent to the current agent for `/drawio [request]`. */
export function buildDrawioPrompt(args: string): string {
  const request = args.trim();
  const task = request.length > 0 ? `Create a draw.io diagram for this request:\n\n${request}` : CLARIFY_REQUEST;
  return `${task}\n\n${DRAWIO_AGENT_INSTRUCTIONS}`;
}
