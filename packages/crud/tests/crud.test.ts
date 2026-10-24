import "@opentyped/framestack-kysely-db-sqlite";
import "@opentyped/framestack-kysely-db-pglite";

import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { CodeError } from "@opentyped/framestack-error";
import { connect, database } from "@opentyped/framestack-kysely-db";
import type { TableInfo } from "@opentyped/framestack-kysely-db/tables";
import express, { type RequestHandler } from "express";
import { type Kysely, sql } from "kysely";

import { crudClient } from "../dist/client.js";
import { crud, type CrudOptions } from "../dist/index.js";

/** Table info shaped like the generated `tables.ts`. */
function table(
  name: string,
  columns: Record<string, string>,
  generated: string[] = [],
): TableInfo {
  return {
    schema: "public",
    name,
    kind: "table",
    primaryKey: "id" in columns ? ["id"] : [],
    columns: Object.entries(columns).map(([column, type]) => ({
      name: column,
      type,
      nullable: false,
      primaryKey: column === "id",
      generated: generated.includes(column),
      optional: column === "id",
      annotations: {},
    })),
  };
}

const tables = {
  author: table("author", { id: "integer", name: "text", password: "text" }),
  post: table("post", {
    id: "integer",
    author_id: "integer",
    title: "text",
    published: "integer",
  }),
  comment: table("comment", {
    id: "integer",
    post_id: "integer",
    body: "text",
  }),
  tag: table("tag", { id: "integer", name: "text" }),
  post_tag: table("post_tag", { post_id: "integer", tag_id: "integer" }),
};

const schema = [
  sql`CREATE TABLE author (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, password TEXT NOT NULL)`,
  sql`CREATE TABLE post (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES author (id), title TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0)`,
  sql`CREATE TABLE comment (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES post (id), body TEXT NOT NULL)`,
  sql`CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
  sql`CREATE TABLE post_tag (post_id INTEGER NOT NULL REFERENCES post (id), tag_id INTEGER NOT NULL REFERENCES tag (id))`,
  sql`INSERT INTO author (id, name, password) VALUES (1, 'ada', 'x'), (2, 'alan', 'y')`,
  sql`INSERT INTO post (id, author_id, title, published) VALUES (1, 1, 'engines', 1), (2, 2, 'machines', 1), (3, 1, 'draft', 0)`,
  sql`INSERT INTO comment (id, post_id, body) VALUES (1, 1, 'first'), (2, 1, 'second'), (3, 2, 'hello')`,
  sql`INSERT INTO tag (id, name) VALUES (1, 'math'), (2, 'history')`,
  sql`INSERT INTO post_tag (post_id, tag_id) VALUES (1, 1), (1, 2), (2, 2)`,
];

/** Requests this test saw at each middleware, in order. */
const seen: string[] = [];
const mark =
  (name: string): RequestHandler =>
  (req, _res, next) => {
    seen.push(`${name} ${req.method}`);
    next();
  };
const admin: RequestHandler = (req, _res, next) =>
  next(req.get("x-admin") ? undefined : CodeError.forbidden("admins only"));

const resources: CrudOptions<typeof tables>["resources"] = {
  posts: {
    table: "post",
    middlewares: mark("posts"),
    // Readers only see published posts; admins see all of them.
    query: (qb, { req }) =>
      req.get("x-admin") ? qb : qb.where("main.published", "=", 1),
    joins: {
      author: {
        table: "author",
        on: { author_id: "id" },
        columns: ["id", "name"],
      },
      comments: {
        table: "comment",
        on: { id: "post_id" },
        many: true,
        columns: ["id", "body"],
        orderBy: [{ field: "id", order: "desc" }],
      },
      // Two hops: post → post_tag → tag.
      tags: {
        table: "tag",
        through: { table: "post_tag", on: { id: "post_id" } },
        on: { tag_id: "id" },
        many: true,
      },
    },
    select: {
      comment_count: (eb) =>
        eb
          .selectFrom("comment")
          .select((inner) => inner.fn.countAll().as("count"))
          .whereRef("comment.post_id", "=", "main.id"),
    },
    actions: {
      list: true,
      show: true,
      create: {
        columns: ["author_id", "title"],
        validate: (input) => ({ ...input, title: String(input.title).trim() }),
      },
      update: { columns: ["title", "published"] },
      delete: { middlewares: [mark("delete"), admin] },
    },
  },
  authors: {
    table: "author",
    joins: {
      posts: {
        table: "post",
        on: { id: "author_id" },
        many: true,
        columns: ["title"],
      },
    },
    actions: { list: true, show: true },
  },
};

/** A crud server over a database; returns its base URL and a closer. */
async function serve(db: Kysely<any>) {
  const app = express();

  app.use((_req, res, next) => {
    res.locals.db = db;
    next();
  });
  app.use("/admin", crud({ tables, resources, middlewares: mark("all") }));
  app.use(((error, _req, res, _next) => {
    const coded = CodeError.from(error);

    res.status(coded.status).json(coded.toJSON());
  }) satisfies express.ErrorRequestHandler);

  const server = app.listen(0, "127.0.0.1");

  await once(server, "listening");

  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`,
    close: () => server.close(),
  };
}

const db = database(connect("sqlite://:memory:"));
let base: string;
let close: () => void;

before(async () => {
  for (const statement of schema) {
    await statement.execute(db);
  }

  ({ base, close } = await serve(db));
});

after(async () => {
  close();
  await db.destroy();
});

/** A JSON request: status and body. */
async function call(
  path: string,
  init: RequestInit & { admin?: boolean } = {},
) {
  const response = await fetch(base + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.admin ? { "x-admin": "1" } : {}),
    },
  });

  return { status: response.status, body: await response.json() };
}

const filters = (value: unknown) =>
  `filters=${encodeURIComponent(JSON.stringify(value))}`;

test("rows embed joins (one, many, two hops) and computed fields", async () => {
  const { status, body } = await call("/posts?sort=id");

  assert.equal(status, 200);
  assert.equal(body.total, 2);
  assert.deepEqual(body.data[0], {
    id: 1,
    author_id: 1,
    title: "engines",
    published: 1,
    comment_count: 2,
    author: { id: 1, name: "ada" },
    comments: [
      { id: 2, body: "second" },
      { id: 1, body: "first" },
    ],
    tags: [
      { id: 1, name: "math" },
      { id: 2, name: "history" },
    ],
  });
  assert.deepEqual(body.data[1].comments, [{ id: 3, body: "hello" }]);

  // Sensitive columns are not selected, not even inside joins.
  const authors = await call("/authors?sort=id");

  assert.deepEqual(authors.body.data[0], {
    id: 1,
    name: "ada",
    posts: [{ title: "engines" }, { title: "draft" }],
  });
});

test("filters and sorts reach joins and computed fields", async () => {
  const byAuthor = await call(
    `/posts?${filters([{ field: "author.name", operator: "eq", value: "alan" }])}`,
  );

  assert.deepEqual(
    byAuthor.body.data.map((row: { title: string }) => row.title),
    ["machines"],
  );

  // A `many` join matches when any of its rows does.
  const tagged = await call(
    `/posts?sort=id&${filters([{ field: "tags.name", operator: "eq", value: "history" }])}`,
  );

  assert.deepEqual(
    tagged.body.data.map((row: { id: number }) => row.id),
    [1, 2],
  );

  const discussed = await call(
    `/posts?${filters([{ field: "comment_count", operator: "gte", value: 2 }])}`,
  );

  assert.equal(discussed.body.total, 1);

  const sorted = await call("/posts?sort=author.name.desc");

  assert.deepEqual(
    sorted.body.data.map((row: { title: string }) => row.title),
    ["machines", "engines"],
  );

  // Unknown fields, hidden columns, and sorting on many values are refused.
  for (const path of [
    `/posts?${filters([{ field: "nope", operator: "eq", value: 1 }])}`,
    `/authors?${filters([{ field: "password", operator: "eq", value: "x" }])}`,
    `/posts?${filters([{ field: "author.password", operator: "eq", value: "x" }])}`,
    "/posts?sort=tags.name",
  ]) {
    assert.equal((await call(path)).status, 400, path);
  }
});

test("the resource query scopes every action, including writes", async () => {
  assert.equal((await call("/posts/3")).status, 404);
  assert.equal(
    (await call("/posts/3", { admin: true })).body.data.title,
    "draft",
  );
  assert.equal((await call("/posts", { admin: true })).body.total, 3);
  assert.equal(
    (
      await call("/posts/3", {
        method: "PATCH",
        body: JSON.stringify({ title: "leak" }),
      })
    ).status,
    404,
  );
});

test("middlewares run router → resource → action, and guard actions", async () => {
  seen.length = 0;
  assert.equal((await call("/posts/2", { method: "DELETE" })).status, 403);
  assert.deepEqual(seen, ["all DELETE", "posts DELETE", "delete DELETE"]);
  assert.equal((await call("/posts/2")).status, 200);
});

test("writes keep to their columns, validate, and answer with joins", async () => {
  const created = await call("/posts", {
    method: "POST",
    body: JSON.stringify({ author_id: 2, title: "  computing  " }),
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.data.title, "computing");
  assert.deepEqual(created.body.data.author, { id: 2, name: "alan" });
  assert.deepEqual(created.body.data.comments, []);

  const id = created.body.data.id;

  assert.equal(
    (
      await call("/posts", {
        method: "POST",
        body: JSON.stringify({ author_id: 2, title: "x", published: 1 }),
      })
    ).status,
    400,
  );

  const updated = await call(`/posts/${id}`, {
    method: "PATCH",
    admin: true,
    body: JSON.stringify({ published: 1 }),
  });

  assert.equal(updated.body.data.published, 1);

  const client = crudClient(base);

  assert.equal(
    (await client.getOne<{ title: string }>({ resource: "posts", id })).data
      .title,
    "computing",
  );

  const removed = await call(`/posts/${id}`, { method: "DELETE", admin: true });

  assert.equal(removed.body.data.id, id);
  assert.equal((await call(`/posts/${id}`)).status, 404);
  // Actions that are not listed are not served at all.
  assert.equal(
    (await fetch(`${base}/authors/1`, { method: "DELETE" })).status,
    404,
  );
});

test("definitions are checked when the router is built", () => {
  assert.throws(
    () =>
      crud({
        tables,
        resources: {
          bad: {
            table: "post",
            joins: { author: { table: "author", on: { writer_id: "id" } } },
            actions: { list: true },
          },
        },
      }),
    /join author on writer_id → id does not exist/,
  );
  assert.throws(
    () =>
      crud({
        tables,
        resources: { bad: { table: "nope" as never, actions: {} } },
      }),
    /unknown table nope/,
  );
});

test("PostgreSQL embeds the same JSON", async () => {
  const pg = database(connect("pglite://memory"));

  try {
    for (const statement of schema) {
      await statement.execute(pg);
    }

    const server = await serve(pg);

    try {
      const response = await fetch(`${server.base}/posts/1`);
      const { data } = await response.json();

      assert.deepEqual(data.author, { id: 1, name: "ada" });
      assert.deepEqual(
        data.tags.map((tag: { name: string }) => tag.name),
        ["math", "history"],
      );
      assert.equal(Number(data.comment_count), 2);

      const tagged = await fetch(
        `${server.base}/posts?${filters([{ field: "tags.name", operator: "contains", value: "HIST" }])}`,
      );

      assert.equal((await tagged.json()).total, 2);
    } finally {
      server.close();
    }
  } finally {
    await pg.destroy();
  }
});
