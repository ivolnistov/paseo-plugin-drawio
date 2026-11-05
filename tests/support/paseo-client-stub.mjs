// Inert stand-ins for host UI modules so the real client entry can be imported under Node.
export const useRpc = () => async () => ({});
export const useFileText = () => ({ status: "loading" });
export class PluginFileDeletedError extends Error {}
export const Markdown = () => null;
export const Loading = () => null;
export const StreamedText = () => null;
