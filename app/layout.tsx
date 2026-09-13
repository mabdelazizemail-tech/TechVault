import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/components/shell/theme";
import "./globals.css";

/**
 * Archivo is the only typeface in the design system. `next/font` self-hosts it,
 * so the browser never calls Google — which also keeps a future CSP simple.
 */
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: {
    default: "TechVault",
    template: "%s · TechVault",
  },
  description: "Modular enterprise platform.",
  // Internal platform: never index it.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout.
 *
 * `lang` and `dir` are set here and nowhere else (CLAUDE.md §16.7, ADR-009).
 *
 * The theme is read from a cookie on the server rather than applied by an inline
 * script after load: there is no flash of the wrong theme, and no inline script
 * for a future Content-Security-Policy to allow. With no cookie, the tokens follow
 * the operating system's preference.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="en" dir="ltr" data-theme={theme} className={archivo.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
