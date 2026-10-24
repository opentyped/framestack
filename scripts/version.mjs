import { globSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const tag = process.argv[2];

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
  throw new Error("Expected a release tag such as v1.2.3 or v1.2.3-beta.1");
}

const version = tag.slice(1);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const root = read("package.json");
const files = root.workspaces.flatMap((pattern) =>
  globSync(`${pattern}/package.json`),
);
const names = new Set(
  files
    .map((file) => read(file))
    .filter((pkg) => !pkg.private)
    .map((pkg) => pkg.name),
);

// Let npm validate the version before changing workspace manifests.
execFileSync(
  "npm",
  [
    "version",
    version,
    "--no-git-tag-version",
    "--allow-same-version",
    "--ignore-scripts",
    "--workspaces=false",
  ],
  { stdio: "inherit" },
);

for (const file of ["package.json", ...files]) {
  const pkg = read(file);

  if (names.has(pkg.name)) {
    pkg.version = version;
  }

  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (names.has(name)) {
        pkg[field][name] = version;
      }
    }
  }

  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}

execFileSync(
  "npm",
  [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  { stdio: "inherit" },
);
