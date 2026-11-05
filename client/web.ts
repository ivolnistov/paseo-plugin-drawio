import { Platform } from "react-native";
import { MAX_EXPANDED_BYTES } from "../shared/constants";

// The only module that touches the browser DOM. Every export is a no-op off the web.
declare const document: { createElement(tag: "iframe"): BrowserFrame };
declare const window: {
  addEventListener(type: "message", listener: (event: FrameMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: FrameMessageEvent) => void): void;
};

interface BrowserFrame {
  srcdoc: string;
  readonly contentWindow: unknown;
  readonly style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
interface FrameHost {
  appendChild(child: BrowserFrame): void;
}
interface FrameMessageEvent {
  source: unknown;
  data: unknown;
}

export const FRAME_CHANNEL = "paseo-drawio";

/** Network is closed: only inline script and data/blob images and fonts can load. */
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export interface FrameHtmlOptions {
  viewerSource: string;
  xml: string;
  nonce: string;
  dark: boolean;
  background: string;
  foreground: string;
  fill: boolean;
}

/**
 * Measures compressed pages exactly as the viewer will read them: the parsed document's page text
 * (trimmed textContent, with entities, CDATA and child text resolved by the browser's XML parser),
 * base64-decoded and inflated with the viewer's own pako, stopping once the budget is passed.
 * Pages the viewer cannot decode either are skipped; the viewer reports them.
 */
export const EXPANSION_GATE_SCRIPT = `function expandedSize(doc,limit){
  var root=doc.documentElement,total=0;
  if(!root||root.nodeName!=="mxfile"||typeof pako==="undefined")return 0;
  var pages=root.getElementsByTagName("diagram");
  for(var i=0;i<pages.length;i++){
    var text=(pages[i].textContent||"").trim();
    if(!text)continue;
    var binary;try{binary=atob(text);}catch(e){continue;}
    var bytes=new Uint8Array(binary.length);for(var j=0;j<binary.length;j++)bytes[j]=binary.charCodeAt(j);
    var inflator=new pako.Inflate({raw:true,chunkSize:65536}),over=false;
    inflator.onData=function(chunk){total+=chunk.length;if(total>limit){over=true;throw new Error("over");}};
    inflator.onEnd=function(){};
    try{inflator.push(bytes,true);}catch(e){}
    if(over)return limit+1;
  }
  return total;
}`;

export type FrameEvent =
  | { type: "rendered"; pages: number }
  | { type: "error"; message: string }
  | { type: "size"; height: number };

function escapeForScript(text: string): string {
  return text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function cssColor(value: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : "transparent";
}

/** Builds the sandboxed document that runs the official GraphViewer on one diagram. */
export function buildFrameHtml(options: FrameHtmlOptions): string {
  const config = {
    channel: FRAME_CHANNEL,
    nonce: options.nonce,
    maxExpandedBytes: MAX_EXPANDED_BYTES,
    graph: {
      xml: options.xml,
      toolbar: "pages zoom layers",
      "toolbar-nohide": true,
      "toolbar-position": "top",
      nav: true,
      resize: !options.fill,
      "auto-fit": true,
      "check-visible-state": false,
      "dark-mode": options.dark ? "dark" : "light",
      "show-link-icons": false,
      lightbox: false,
      highlight: "#3572b0",
    },
  };
  const background = cssColor(options.background);
  const foreground = cssColor(options.foreground);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:${background};color:${foreground};font-family:system-ui,sans-serif}
body{overflow:auto}#root{padding:4px}#root .mxgraph{max-width:100%}
.drawio-error{padding:12px;font-size:13px}</style></head><body><div id="root"></div>
<script>${escapeForScript(options.viewerSource)}</script>
<script>(function(){
var C=${jsonForScript(config)};
function post(type,detail){parent.postMessage({channel:C.channel,nonce:C.nonce,type:type,detail:detail},"*");}
function fail(message){var root=document.getElementById("root");root.textContent="";var p=document.createElement("div");p.className="drawio-error";p.textContent=message;root.appendChild(p);post("error",{message:message});}
window.addEventListener("error",function(e){post("error",{message:String(e&&e.message||"Viewer error")});});
${EXPANSION_GATE_SCRIPT}
function blockLinks(e){var n=e.target;while(n&&n.nodeName&&n.nodeName.toLowerCase()!=="a")n=n.parentNode;if(n&&n.getAttribute&&(n.getAttribute("href")||"").charAt(0)!=="#")e.preventDefault();}
document.addEventListener("click",blockLinks,true);document.addEventListener("auxclick",blockLinks,true);
window.open=function(){return null;};
try{
  if(typeof GraphViewer==="undefined"){fail("The draw.io viewer did not load.");return;}
  if(typeof Graph!=="undefined"){Graph.prototype.openLink=function(){return null;};}
  var doc=new DOMParser().parseFromString(C.graph.xml,"text/xml");
  if(doc.getElementsByTagName("parsererror").length>0){fail("This diagram's XML could not be parsed.");return;}
  if(expandedSize(doc,C.maxExpandedBytes)>C.maxExpandedBytes){fail("This diagram is too large to show here: its compressed pages expand beyond the limit of "+C.maxExpandedBytes+" bytes.");return;}
  var el=document.createElement("div");el.className="mxgraph";
  el.setAttribute("data-mxgraph",JSON.stringify(C.graph));
  document.getElementById("root").appendChild(el);
  GraphViewer.createViewerForElement(el,function(viewer){
    var pages=viewer&&viewer.diagrams?viewer.diagrams.length:1;
    post("rendered",{pages:pages});
  });
}catch(e){fail("The diagram could not be rendered: "+String(e&&e.message||e));}
if(typeof ResizeObserver!=="undefined"){
  var root=document.getElementById("root");
  new ResizeObserver(function(){post("size",{height:root.scrollHeight});}).observe(root);
}
})();</script></body></html>`;
}

function toFrameEvent(data: unknown, nonce: string): FrameEvent | null {
  if (!data || typeof data !== "object") return null;
  const message = data as { channel?: unknown; nonce?: unknown; type?: unknown; detail?: Record<string, unknown> };
  if (message.channel !== FRAME_CHANNEL || message.nonce !== nonce) return null;
  const detail = message.detail ?? {};
  if (message.type === "rendered") return { type: "rendered", pages: Number(detail.pages) || 1 };
  if (message.type === "error") return { type: "error", message: String(detail.message ?? "Viewer error") };
  if (message.type === "size") {
    const height = Number(detail.height);
    return Number.isFinite(height) && height > 0 ? { type: "size", height } : null;
  }
  return null;
}

export interface MountFrameOptions extends Omit<FrameHtmlOptions, "nonce"> {
  minHeight: number;
  maxHeight: number;
  onEvent(event: FrameEvent): void;
}

function makeNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Mounts one viewer frame into a host element. The returned cleanup removes the frame and its listener. */
export function mountFrame(host: unknown, options: MountFrameOptions): () => void {
  if (Platform.OS !== "web" || !host) return () => {};
  const nonce = makeNonce();
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", "draw.io diagram");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.style.border = "0";
  frame.style.display = "block";
  frame.style.width = "100%";
  frame.style.height = options.fill ? "100%" : `${options.minHeight}px`;
  frame.style.background = cssColor(options.background);

  const listener = (event: FrameMessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const parsed = toFrameEvent(event.data, nonce);
    if (!parsed) return;
    if (parsed.type === "size" && !options.fill) {
      const height = Math.min(options.maxHeight, Math.max(options.minHeight, Math.ceil(parsed.height)));
      frame.style.height = `${height}px`;
    }
    options.onEvent(parsed);
  };
  window.addEventListener("message", listener);
  frame.srcdoc = buildFrameHtml({ ...options, nonce });
  (host as FrameHost).appendChild(frame);
  return () => {
    window.removeEventListener("message", listener);
    frame.srcdoc = "";
    frame.remove();
  };
}
