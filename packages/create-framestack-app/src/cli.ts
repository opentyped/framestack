#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, relative, resolve } from "node:path";

import { Command } from "commander";

const template = resolve(import.meta.dirname, "../template");

/** Copy the template into a new directory and name the package after it. */
function create(target: string) {
  const directory = resolve(target);
  const name = basename(directory);

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(
      `"${name}" is not a valid package name; use lowercase letters, digits, ".", "_" or "-"`,
    );
  }

  if (existsSync(directory) && readdirSync(directory).length) {
    throw new Error(`${directory} already exists and is not empty`);
  }

  cpSync(template, directory, { recursive: true });
  renameSync(resolve(directory, "gitignore"), resolve(directory, ".gitignore"));

  const manifest = resolve(directory, "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));

  writeFileSync(manifest, JSON.stringify({ ...pkg, name }, null, 2) + "\n");

  const path = relative(process.cwd(), directory) || ".";

  console.log(`Created ${name}.

  cd ${path}
  npm install
  npm run dev

Change the database, then run \`npm run generate\` to update its types and scaffold models.`);
}

await new Command("create-framestack-app")
  .description(
    "Create an app with Express, React Server Components, typed SQL (Kysely), and a generated OpenAPI document.",
  )
  .argument(
    "<directory>",
    "where to create the app; its name becomes the package name",
  )
  .showHelpAfterError()
  .action((directory: string) => {
    try {
      create(directory);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  })
  .parseAsync();
