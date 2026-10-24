import { existsSync } from "node:fs";

import { z } from "zod";

// .env.local (git-ignored) overrides .env; variables already set win over both.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

/** The app's settings. The server fails to start if any is missing or invalid. */
export const env = z
  .object({
    PORT: z.coerce.number().int().positive(),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]),
    DB_URL: z.string().min(1),
  })
  .parse(process.env);
