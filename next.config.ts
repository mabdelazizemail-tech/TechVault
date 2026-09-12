import type { NextConfig } from "next";

/**
 * Security headers applied to every response. See CLAUDE.md §18.3.
 *
 * CSP is intentionally omitted here for now: Next.js needs a nonce-based policy
 * to allow its own inline bootstrap scripts, which belongs in middleware rather
 * than a static header. Tracked as technical debt (CLAUDE.md §29) — do not
 * replace this note with a permissive `unsafe-inline` policy.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the production build on type errors. Never disable this: a green build
  // that hides errors is worse than a red one. Linting is not part of `next build`
  // in Next 16 — `npm run verify` runs ESLint, and CI runs `verify`.
  typescript: { ignoreBuildErrors: false },

  // Do not leak framework details.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
