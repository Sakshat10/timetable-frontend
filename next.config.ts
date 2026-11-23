import type { NextConfig } from "next";
import { serverEnv } from "./src/lib/server-env";

/**
 * Same-origin forwarding (docs/architecture/FRONTEND-ARCHITECTURE.md §2.1, option A):
 * the browser calls /api/* on this origin and Next.js forwards it to the Fastify backend.
 * The session cookie is therefore first-party and SameSite=Strict works in production.
 *
 * BACKEND_URL is read at build time for the rewrite destination and at runtime by
 * server components (src/lib/api/server.ts). Client-IP propagation through this layer is
 * measured, not assumed: see docs/architecture/PHASE-1-AUTH-PROXY-RESULTS.md.
 */
const { BACKEND_URL } = serverEnv();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The application is fully authenticated and client-data driven, so it uses the
  // request-time rendering model rather than Cache Components (see the architecture doc).
  poweredByHeader: false,
  // A separate build directory lets a second instance (tests, measurements) run beside `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
