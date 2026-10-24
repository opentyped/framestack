#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { connect, driverOf, type Pool } from "@opentyped/framestack-kysely-db";
import { generate } from "@opentyped/framestack-kysely-db/generate";
import { Command } from "commander";

// DB_URL may come from .env.local or .env, as it does for the app. Earlier files win.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

/** Import the driver for the URL's scheme, open a pool, and close it after `fn`. */
async function withPool(
  url: string | undefined,
  fn: (pool: Pool) => Promise<void>,
) {
  if (!url) {
    throw new Error("Set DB_URL in the environment or .env, or pass --url");
  }

  const scheme = url.split(":")[0]!.toLowerCase();

  const driver = `@opentyped/framestack-kysely-db-${scheme === "sqlite" || scheme === "pglite" ? scheme : "pg"}`;
  // Resolve the driver from the app, which installs only the drivers it uses.
  const app = createRequire(join(process.cwd(), "package.json"));
  let entry: string;

  try {
    entry = app.resolve(driver);
  } catch {
    throw new Error(
      `${url.split(":")[0]}:// needs ${driver}; npm install ${driver}`,
    );
  }

  await import(pathToFileURL(entry).href);
  driverOf(url);

  const pool = connect(url);

  try {
    await fn(pool);
  } finally {
    await pool.close();
  }
}

const program = new Command("framestack")
  .description("Generate database types and models for a framestack app.")
  .option(
    "--url <url>",
    "sqlite://app.db, postgres://user:pass@host/db, or pglite://data",
    process.env.DB_URL,
  )
  .showHelpAfterError();

program
  .command("generate")
  .description(
    "write declarations and table info; create models for new tables",
  )
  .option("--types <dir>", "generated declarations", "src/types")
  .option("--models <dir>", "model files, created once", "src/models")
  .action((options: { types: string; models: string }) =>
    withPool(program.opts().url, async (pool) => {
      const created = await generate(pool, options);

      console.log(
        `Generated ${options.types}/{models.d.ts,kysely.d.ts,tables.ts}` +
          created.map((file: string) => `\nCreated ${file}`).join(""),
      );
    }),
  );

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
