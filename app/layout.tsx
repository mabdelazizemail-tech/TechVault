import type { Metadata, Viewport } from "next";
import "./globals.css";

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
 * `lang` and `dir` are set here and nowhere else. When Arabic is enabled
 * (ADR-009) these come from the user's locale — which is why every component uses
 * logical CSS properties (`ms-`/`me-`, `start`/`end`) rather than left/right, so
 * RTL is an attribute change rather than a rewrite (CLAUDE.md §16.7).
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
