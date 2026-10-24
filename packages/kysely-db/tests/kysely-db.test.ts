import "@opentyped/framestack-kysely-db-sqlite";
import "@opentyped/framestack-kysely-db-pg";
import "@opentyped/framestack-kysely-db-pglite";

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { CodeError, ErrorCode } from "@opentyped/framestack-error";
import { sql } from "kysely";

import { generate } from "../dist/generate.js";
import {
  begin,
  connect,
  database,
  type Logger,
  query,
  raw,
  store,
} from "../dist/index.js";

interface Todo {
  todo: { id: number; title: string };
}

/** Collect log calls with their merged fields. */
function recorder() {
  const lines: Record<string, unknown>[] = [];
  const logger = (fields: object = {}): Logger & { child: typeof child } => ({
    debug: (more, msg) => lines.push({ ...fields, ...more, msg }),
    error: (more, msg) => lines.push({ ...fields, ...more, msg }),
    child: (more: object) => logger({ ...fields, ...more }),
  });
  const child = (more: object) => logger(more);

  return { lines, logger: logger() };
}

const schemas = {
  sqlite: `CREATE TABLE todo (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(title) <= 200)) STRICT;`,
  pg: `CREATE TABLE todo (id SERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL);
       CREATE SCHEMA billing;
       CREATE TABLE billing.invoice (id SERIAL PRIMARY KEY, total INTEGER NOT NULL);`,
};

/** Run the whole flow for one URL: create tables, generate, scaffold, query, log. */
async function flow(url: string, schema: string) {
  const root = mkdtempSync(join(tmpdir(), "framestack-db-"));
  const pool = connect(url.replace("{root}", root));

  try {
    const setup = database(pool);

    for (const statement of schema.split(";").filter((part) => part.trim())) {
      await sql.raw(statement).execute(setup);
    }

    const created = await generate(pool, { root });

    assert.ok(
      created.includes(join("src", "models", "todo.ts")),
      String(created),
    );

    // Tables outside the default schema get a schema folder.
    if (schema.includes("billing.invoice")) {
      assert.ok(
        created.includes(join("src", "models", "billing", "invoice.ts")),
      );
      assert.match(
        readFileSync(join(root, "src/models/billing/invoice.ts"), "utf8"),
        /from "odb\/billing";\n\/\/ import type \{ Conn \} from "odb\/kysely";\nimport type \* as row from "odb\/kysely\/billing";[\s\S]*tables\["billing\.invoice"\]/,
      );
    }

    for (const file of ["models.d.ts", "kysely.d.ts", "tables.ts"]) {
      assert.ok(existsSync(join(root, "src/types", file)), file);
    }

    const tables = readFileSync(join(root, "src/types/tables.ts"), "utf8");

    assert.match(tables, /"todo": \{/);
    assert.match(
      readFileSync(join(root, "src/models/todo.ts"), "utf8"),
      // The default schema (SQLite main, Postgres public) comes from the root modules.
      /import type \* as model from "odb";\nimport type \* as row from "odb\/kysely";\n\/\/ import type \{ Conn \} from "odb\/kysely";[\s\S]*\/\*\* @schema \*\/\nexport type Todo = model\.Todo;[\s\S]*export type NewTodo = row\.NewTodo;[\s\S]*export const tododb = \{[\s\S]*\/\/ async findAll\(conn: Conn\) \{\n  \/\/   return conn\.selectFrom\("todo"\)\.selectAll\(\)\.orderBy\("id"\)\.execute\(\);[\s\S]*export default tododb;/,
    );

    // Existing model files are never overwritten.
    writeFileSync(join(root, "src/models/todo.ts"), "// mine\n");
    assert.deepEqual(await generate(pool, { root }), []);
    assert.equal(
      readFileSync(join(root, "src/models/todo.ts"), "utf8"),
      "// mine\n",
    );

    // Queries log on the request's logger, tagged with its ids.
    const { lines, logger } = recorder();
    const db = database<Todo>(pool, { logger });

    await store.run({ log: logger.child({ clientId: "abc" }) }, async () => {
      await db
        .insertInto("todo")
        .values({ title: "one" } as never)
        .execute();
    });
    await db.selectFrom("todo").selectAll().execute();

    const queries = lines.filter((line) => line.msg === "query");

    assert.equal(queries.at(-2)!.clientId, "abc");
    assert.match(String(queries.at(-2)!.sql), /^insert into "todo"/);
    assert.equal(queries.at(-1)!.clientId, undefined);

    // Affected rows and transactions behave as Kysely documents.
    const updated = await db
      .updateTable("todo")
      .set({ title: "two" })
      .executeTakeFirst();

    assert.equal(updated.numUpdatedRows, 1n);
    await assert.rejects(
      begin(db, async (tx) => {
        await tx.deleteFrom("todo").execute();
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal((await db.selectFrom("todo").selectAll().execute()).length, 1);

    // Plain SQL and builder helpers share result shapes.
    const [row] = await raw.any<{ id: number; title: string }>(
      db,
      sql`select id, title from todo`,
    );

    assert.equal(row!.title, "two");
    assert.equal(
      await raw.maybeOne(db, sql`select * from todo where id = ${-1}`),
      null,
    );
    await assert.rejects(
      raw.one(db, sql`select * from todo where id = ${-1}`),
      (error) => CodeError.is(error, ErrorCode.NotFound),
    );
    assert.equal(
      (await query.one(db.selectFrom("todo").selectAll())).title,
      "two",
    );
    assert.equal(
      await query.maybeOne(
        db.selectFrom("todo").selectAll().where("id", "=", -1),
      ),
      null,
    );

    // Kysely itself throws the driver's CodeError for constraint violations.
    const duplicate = await db
      .insertInto("todo")
      .values({ id: row!.id, title: "dup" })
      .execute()
      .catch((error: unknown) => error);

    assert.ok(
      CodeError.is(duplicate, ErrorCode.AlreadyExists),
      String(duplicate),
    );
    assert.equal(duplicate.status, 409);

    // Failed queries are logged as errors.
    await assert.rejects(sql`select * from missing`.execute(db));
    assert.equal(lines.at(-1)!.msg, "query failed");
    await db.destroy();
  } finally {
    await pool.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
}

test("sqlite:// migrates, generates, scaffolds, and logs per request", () =>
  flow("sqlite://{root}/app.db", schemas.sqlite));

test("pglite:// does the same in-process", () =>
  flow("pglite://memory", schemas.pg));

test("postgres:// does the same over a real Postgres wire connection", async () => {
  const server = new PGLiteSocketServer({
    db: await PGlite.create(),
    port: 0,
    host: "127.0.0.1",
    maxConnections: 10,
  });

  await server.start();

  try {
    await flow(
      `postgres://postgres:postgres@${server.getServerConn()}/postgres`,
      schemas.pg,
    );
  } finally {
    await server.stop();
  }
});

test("unknown schemes name the driver to import", () => {
  assert.throws(
    () => connect("mysql://x"),
    /No database driver for mysql:\/\//,
  );
  assert.throws(() => connect("app.db"), /scheme:\/\/location/);
});
