/**
 * Providers that receive the Tool Server. Paseo fails an agent open when it injects MCP servers
 * into a provider without MCP support, so unknown providers are skipped rather than guessed.
 */
export const MCP_PROVIDERS: readonly string[] = ["claude", "codex", "opencode"];

export interface ToolServerTarget {
  provider: string;
  purpose: "interactive" | "history";
  cwd: string;
}

export function shouldInjectToolServer(
  request: ToolServerTarget,
  providers: readonly string[] = MCP_PROVIDERS,
): boolean {
  return request.purpose === "interactive" && request.cwd.length > 0 && providers.includes(request.provider);
}
