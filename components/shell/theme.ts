/** Shared by the server (root layout) and the client (theme toggle). */
export const THEME_COOKIE = "tv-theme";

export type Theme = "light" | "dark";

/** An unknown or missing value means "follow the system preference". */
export function parseTheme(value: string | undefined): Theme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}
