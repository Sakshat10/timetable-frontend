import { z } from "zod";

/**
 * Server-only configuration. Validated when it is first read (next.config.ts and the
 * server-side API helper). There is deliberately no NEXT_PUBLIC_* API URL: the browser only
 * ever calls `/api/*` on the frontend origin (see docs/architecture/FRONTEND-ARCHITECTURE.md §2).
 */
const schema = z.object({
  BACKEND_URL: z
    .string({ error: "BACKEND_URL is required (for example http://127.0.0.1:4000)" })
    .url("BACKEND_URL must be an absolute http(s) URL, for example http://127.0.0.1:4000")
    .refine((value) => /^https?:\/\//.test(value), "BACKEND_URL must start with http:// or https://")
    .refine((value) => !/\/api\/?$/.test(value), "BACKEND_URL is the backend origin, without the /api suffix")
    .transform((value) => value.replace(/\/+$/, "")),
});

export type ServerEnv = z.output<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse({ BACKEND_URL: process.env.BACKEND_URL });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `- ${issue.message}`).join("\n");
    throw new Error(`Invalid frontend environment:\n${details}\nCopy .env.example to .env.local and set the values.`);
  }
  cached = parsed.data;
  return cached;
}
