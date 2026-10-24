import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const cli = resolve(
  import.meta.dirname,
  "../packages/create-framestack-app/dist/cli.js",
);

/** Run the CLI and return its exit code and output. */
function createApp(args: string[], cwd: string) {
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [cli, ...args], {
        cwd,
        encoding: "utf8",
      }),
    };
  } catch (error) {
    const failure = error as { status: number; stderr: string };

    return { code: failure.status, output: failure.stderr };
  }
}

/** List every file below a directory, relative to it. */
function files(directory: string, prefix = ""): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(prefix, entry.name);

      return entry.isDirectory() ? files(directory, path) : [path];
    })
    .sort();
}

/** Find a free local port. */
async function freePort() {
  const socket = createServer().listen(0, "127.0.0.1");

  await once(socket, "listening");

  const { port } = socket.address() as { port: number };

  await new Promise((resolve) => socket.close(resolve));

  return port;
}

test("create copies the template and names the package", () => {
  const root = mkdtempSync(join(tmpdir(), "framestack-create-"));

  try {
    const result = createApp(["my-app"], root);
    const app = join(root, "my-app");

    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /cd my-app/);
    assert.equal(
      JSON.parse(readFileSync(join(app, "package.json"), "utf8")).name,
      "my-app",
    );
    assert.ok(existsSync(join(app, ".gitignore")));
    assert.ok(!existsSync(join(app, "gitignore")));
    assert.ok(existsSync(join(app, ".env")));

    const created = files(app);

    for (const file of [
      "storage/db/.gitkeep",
      "storage/tmp/.gitkeep",
      "src/index.ts",
      "src/env.ts",
      "src/lib/db.ts",
      "src/models/todo.ts",
      "src/types/models.d.ts",
      "src/types/tables.ts",
      "src/app/page.tsx",
      "src/app/_components/form.tsx",
      "eslint.config.js",
      "src/types/openapi.json",
    ]) {
      assert.ok(created.includes(file), file);
    }

    assert.ok(
      !created.some((file) =>
        /node_modules|^dist\/|\.db$|\.env\.local/.test(file),
      ),
    );

    // Everything else is the tested example, byte for byte.
    const example = resolve(import.meta.dirname, "../example");

    for (const file of created.filter((file) => file !== "package.json")) {
      assert.equal(
        readFileSync(join(app, file), "utf8"),
        readFileSync(join(example, file), "utf8"),
        file,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create refuses unsafe targets and unknown commands", () => {
  const root = mkdtempSync(join(tmpdir(), "framestack-refuse-"));

  try {
    mkdirSync(join(root, "taken"));
    writeFileSync(join(root, "taken", "keep.txt"), "mine");

    const taken = createApp(["taken"], root);

    assert.equal(taken.code, 1);
    assert.match(taken.output, /already exists and is not empty/);
    assert.equal(readFileSync(join(root, "taken", "keep.txt"), "utf8"), "mine");
    assert.match(
      createApp(["Bad Name"], root).output,
      /not a valid package name/,
    );
    assert.match(createApp(["a", "b"], root).output, /too many arguments/);
    assert.match(
      createApp([], root).output,
      /missing required argument[\s\S]*Usage: create-framestack-app/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "a created app installs from npm, regenerates, builds, and runs",
  { timeout: 600000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "framestack-app-"));
    const app = join(root, "my-app");
    /** Run npm inside the created app. */
    const npm = (...args: string[]) =>
      execFileSync("npm", args, { cwd: app, stdio: "pipe", encoding: "utf8" });

    try {
      assert.equal(createApp(["my-app"], root).code, 0);
      // framestack's packages come from this workspace; everything else from npm.
      // Overrides point every copy of these packages, nested ones too, at the tarballs.
      const local = Object.fromEntries(
        [
          "eslint",
          "error",
          "kysely-db",
          "kysely-db-sqlite",
          "crud",
          "framestack",
        ].map((name) => [
          name === "framestack" ? name : `@opentyped/framestack-${name}`,
          `file:${join(
            root,
            execFileSync(
              "npm",
              ["pack", "--silent", "--pack-destination", root],
              {
                cwd: resolve(import.meta.dirname, "../packages", name),
                encoding: "utf8",
              },
            ).trim(),
          )}`,
        ]),
      );

      // Until the next odb release, odb also comes from the sibling checkout.
      const odb = resolve(import.meta.dirname, "../../odb/packages");
      const oapiFetch = execFileSync(
        "npm",
        ["pack", "--silent", "--pack-destination", root],
        {
          cwd: resolve(import.meta.dirname, "../../oapi/packages/fetch"),
          encoding: "utf8",
        },
      ).trim();
      const overrides = Object.fromEntries(
        ["db", "kysely", "models", "adapters/pg", "adapters/sqlite"].map(
          (path) => {
            const file = execFileSync(
              "npm",
              ["pack", "--silent", "--pack-destination", root],
              { cwd: join(odb, path), encoding: "utf8" },
            ).trim();

            return [
              `@opentyped/odb-${path.replace("/", "-")}`,
              `file:${join(root, file)}`,
            ];
          },
        ),
      );
      // Until the next oapi release, so is oapi-fetch (client middleware).
      local["@opentyped/oapi-fetch"] = `file:${join(root, oapiFetch)}`;
      // And oapi-compiler (namespaced source models).
      local["@opentyped/oapi-compiler"] = `file:${join(
        root,
        execFileSync("npm", ["pack", "--silent", "--pack-destination", root], {
          cwd: resolve(import.meta.dirname, "../../oapi/packages/compiler"),
          encoding: "utf8",
        }).trim(),
      )}`;
      // And vite-express-rsc (private folders, useLocals).
      local["@opentyped/vite-express-rsc"] = `file:${join(
        root,
        execFileSync("npm", ["pack", "--silent", "--pack-destination", root], {
          cwd: resolve(
            import.meta.dirname,
            "../../vite-express-rsc/packages/vite-express-rsc",
          ),
          encoding: "utf8",
        }).trim(),
      )}`;
      const manifest = join(app, "package.json");

      const pkg = JSON.parse(readFileSync(manifest, "utf8"));

      // npm requires direct dependencies to match their overrides exactly.
      for (const field of ["dependencies", "devDependencies"]) {
        for (const name of Object.keys(pkg[field])) {
          pkg[field][name] = local[name] ?? pkg[field][name];
        }
      }

      writeFileSync(
        manifest,
        JSON.stringify(
          { ...pkg, overrides: { ...local, ...overrides } },
          null,
          2,
        ),
      );
      npm("install", "--no-audit", "--no-fund");

      // Generated files ship with the template and must already be current:
      // `build` regenerates OpenAPI files, and `generate` (below, once the app
      // has created its database) rewrites database types.
      const generated = [
        "src/types/models.d.ts",
        "src/types/kysely.d.ts",
        "src/types/tables.ts",
        "src/models/todo.ts",
        "src/types/openapi.json",
        "src/types/openapi.d.ts",
      ];
      const before = generated.map((file) =>
        readFileSync(join(app, file), "utf8"),
      );

      npm("exec", "--", "tsc", "--noEmit");
      npm("run", "lint");
      npm("run", "build");

      /** Fail when a shipped generated file differs from a fresh generation. */
      const fresh = () =>
        generated.forEach((file, i) =>
          assert.equal(
            readFileSync(join(app, file), "utf8"),
            before[i],
            `${file} is stale; run npm run generate && npm run build`,
          ),
        );

      fresh();

      // The app owns its schema; the test creates the table the example expects.
      const sqlite = new DatabaseSync(join(app, "storage/db/app.db"));

      sqlite.exec(`CREATE TABLE todo (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(title) >= 1) CHECK (length(title) <= 200),
        done INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      INSERT INTO todo (title) VALUES ('One'), ('Two');`);
      sqlite.close();

      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const server = spawn(process.execPath, ["dist/index.js"], {
        cwd: app,
        env: {
          ...process.env,
          PORT: String(port),
          LOG_LEVEL: "warn",
        },
        stdio: "ignore",
      });
      const browser = await chromium.launch();

      try {
        for (let i = 0; ; i++) {
          try {
            await fetch(base + "/api/todos");
            break;
          } catch (error) {
            if (i > 100) {
              throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Generation from the database must match what shipped.
        npm("run", "generate");
        fresh();

        // Native API routes over typed Kysely queries.
        assert.equal(
          (await (await fetch(base + "/api/todos")).json()).length,
          2,
        );

        const created = await (
          await fetch(base + "/api/todos", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"title":"From the API"}',
          })
        ).json();

        assert.deepEqual(created, { id: 3, title: "From the API", done: 0 });

        const updated = await fetch(base + "/api/todos/3", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: '{"done":true}',
        });

        assert.equal((await updated.json()).done, 1);
        assert.equal((await fetch(base + "/api/todos/99")).status, 404);
        assert.equal((await fetch(base + "/todos/99")).status, 404);

        // The served OpenAPI document carries the database's constraints.
        const document = await (await fetch(base + "/api/openapi")).json();

        assert.equal(
          document.components.schemas["models.Todo"].properties.title.maxLength,
          200,
        );

        // Server components, a client component, and client navigation.
        const page = await browser.newPage();
        const errors: string[] = [];

        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(base);
        await expect(page.getByRole("listitem")).toHaveCount(3);
        await page.getByLabel("New todo").fill("From the browser");
        await page.getByRole("button", { name: "Add" }).click();
        await expect(
          page.getByRole("link", { name: "From the browser" }),
        ).toBeVisible();
        await page.getByRole("link", { name: "From the API" }).click();
        await expect(
          page.getByRole("heading", { name: "From the API" }),
        ).toBeVisible();
        await expect(page.getByText("Done")).toBeVisible();
        await expect(page).toHaveTitle("From the API · Todos");
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
        server.kill();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
