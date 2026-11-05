import type { PluginTheme } from "@getpaseo/plugin";

/** True when the theme's base surface is dark, from its relative luminance. */
export function isDarkTheme(theme: PluginTheme): boolean {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(theme.colors.surface0.trim());
  if (!match) return false;
  let hex = match[1]!;
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance < 0.4;
}
