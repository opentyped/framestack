// Copy the tested example into the package as the `create` template.
import { cpSync, renameSync, rmSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";

const example = resolve(import.meta.dirname, "../../../example");
const template = resolve(import.meta.dirname, "../template");
// .env.local holds local secrets and never ships.
const skipped = new Set(["node_modules", "dist", ".env.local"]);

rmSync(template, { recursive: true, force: true });
cpSync(example, template, {
  recursive: true,
  filter: (file) => {
    const parts = relative(example, file).split(sep);

    // storage/ ships as empty folders: only their .gitkeep files.
    if (parts[0] === "storage" && parts.length > 2) {
      return basename(file) === ".gitkeep";
    }

    return !skipped.has(basename(file)) && !file.endsWith(".db");
  },
});
// npm never publishes files named .gitignore; `create` restores the name.
renameSync(resolve(template, ".gitignore"), resolve(template, "gitignore"));
