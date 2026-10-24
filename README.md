# framestack

Create a full-stack TypeScript app from OpenTyped packages:

```sh
npx create-framestack-app my-app
cd my-app
npm install
npm run dev
```

The database drives the types of the whole stack:

```
DB_URL ──generate──► src/types + src/models ──► pages and API routes
                                                     │                          │
                                                     └── @schema models ──oapi──► openapi.json
```

| Package                                                            | Role                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`@opentyped/vite-express-rsc`](../vite-express-rsc)               | Express app with filesystem pages, layouts, and API routes (RSC) |
| [`@opentyped/odb-*`](../odb)                                       | Model and Kysely types generated from the database schema        |
| [`@opentyped/oapi-*`](../oapi), `@opentyped/vite-express-rsc-oapi` | OpenAPI document and declarations from annotated handlers        |

A created app contains:

- `.env` (committed defaults) and `.env.local` (git-ignored overrides and secrets); variables set in the environment win over both. `src/env.ts` loads them with Node's `process.loadEnvFile` and checks them with zod, so `env.PORT` is a number and a missing or invalid variable stops the server at start.
- `DB_URL` picks the database: `sqlite://app.db`, `postgres://user:pass@host/db`, or `pglite://data` (Postgres in-process). `src/lib/db.ts` imports the matching driver (`@opentyped/framestack-kysely-db-sqlite`, `-pg`, `-pglite`) and opens the pool.
- `oapi.config.ts`: OpenAPI generation, run by Vite. `npm run build` and every save in `npm run dev` regenerate `src/types/openapi.{json,d.ts}`; dev also serves the live document at `/openapi.json`, and the app serves the built one at `/api/openapi`.
- `storage/`: runtime data, git-ignored except its folders: `storage/db/` (the SQLite file, `DB_URL=sqlite://storage/db/app.db`) and `storage/tmp/` (temporary files).
- `build/Dockerfile`: `docker build -f build/Dockerfile -t my-app .` installs dependencies, builds `dist/`, and copies only `dist/`, production `node_modules`, `package.json`, and `.env` into `node:24-alpine`. Mount `/app/storage` to keep data.
- `src/index.ts`: your Express server. It creates the pino logger and the Kysely instance once, and per request a child logger tagged with `x-client-id` and a request id. `res.locals.db` and `res.locals.log` reach routes, loaders, and components; every query is logged with the tags of the request that ran it. It ends with an error handler that replies `CodeError.from(error).toJSON()` with the error's HTTP status. Database drivers make Kysely throw `CodeError`s directly (a unique violation is `AlreadyExists`).
- `src/app/`: pages (`page.tsx`), layouts, and API routes (`api/**/route.ts`, documented with `GET.openapi`). Folders starting with `_` (such as `_components`) hold code, not routes. `src/app/_lib/client.ts` is the typed API client: `createClient<schema, CodeError>({ error })` from `@opentyped/oapi-fetch`. Every call resolves `const [resp, err] = await client("/api/todos", { method: "POST", body: { title } })`: `resp` is the documented body, `err` always a `CodeError` (the server's, rebuilt with `CodeError.fromJSON`; network failures and aborts too). It never rejects.
- `src/types/`: generated files. `npm run generate` (`framestack generate`) reads the database at `DB_URL` and writes `models.d.ts` (`odb/<schema>`), `kysely.d.ts` (`odb/kysely/<schema>`), and `tables.ts` (columns, keys, and constraints at runtime); Vite writes `openapi.{json,d.ts}`. `locals.d.ts` types `res.locals`.
- `src/models/<table>.ts`: created by `npm run generate` for each new table with its types (`Todo`, `TodoId`, `NewTodo`, `TodoUpdate`, `TodoTable`), its table info, and a query object named after the table (`tododb`, `authuserdb`) as the default export. After that the file is yours; generation never touches it again.
- `src/lib/`: shared libraries.
- Imports use `~/` for `src/` (`~/models/todo`), never `../`.
- `eslint.config.js`: spreads `@opentyped/framestack-eslint`, like `eslint-config-next` (TypeScript, sorted imports, Prettier, and the layout rules for `src/`); add your own rules after it:
  - Files and folders are single lowercase words (`form.tsx`, `_components`, `(group)`, `[id]`, `[...slug]`, and `name_test.ts` for tests). Model files keep their table's name (`auth_user.ts`).
  - Imports never climb with `../`; use `~/`.
  - Route files (`page`, `layout`, `middleware`, `route`, `loading`, `error`) are never imported.
  - In `src/app`, code imports only from its own route folder or an ancestor: `app/home/_components/b.tsx` can import `app/a.tsx`, never the reverse. Code outside `src/app` never imports from it.

SQLite runs on Node's built-in `node:sqlite`, so there is no native dependency. The pg driver needs `pg`, the pglite driver `@electric-sql/pglite`; PGlite's single connection serves one transaction at a time and does not support `.stream()`. Requires Node 22.22+.

## CRUD resources

`crud()` from `@opentyped/framestack-crud` serves each resource at `/<name>` and `/<name>/:id` (refine's REST shape). A resource names its table, the actions it allows, and how its rows are built; the main table is `main` in every query.

```ts
server.use(
  "/admin",
  crud({
    tables,
    middlewares: mustAdmin, // every resource
    resources: {
      posts: {
        table: "post",
        // Narrows list, show, update, and delete alike.
        query: (qb, { res }) =>
          qb.where("main.org_id", "=", res.locals.user.org_id),
        joins: {
          author: {
            table: "auth_user",
            on: { author_id: "id" },
            columns: ["id", "username"],
          },
          comments: { table: "comment", on: { id: "post_id" }, many: true },
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
              .select((e) => e.fn.countAll().as("n"))
              .whereRef("comment.post_id", "=", "main.id"),
        },
        actions: {
          list: true,
          show: true,
          create: {
            columns: ["title", "body"],
            validate: (input) => schema.parse(input),
          },
          update: { columns: ["title"] },
          delete: { middlewares: [mustOwner] },
        },
      },
    },
  }),
);
```

- Joins are embedded on each row as JSON (an object, or an array with `many`), through correlated subqueries, so a join never multiplies rows or `total`. `where` adds a condition on the joined rows and `orderBy` orders a `many` array.
- Filters (`?filters=` JSON or base64) and `?sort=` accept columns, computed fields, and `join.column` (`author.username`, `tags.name`); a `many` join matches when any of its rows does and cannot be sorted on. Anything else is a 400.
- Columns named `password`, `secret`, `token`, or `key` are never selected, filtered, or written unless listed in `columns`. Actions that are not listed are not routed.
- Middlewares run in order: router, resource, action. Created rows are answered with their joins.

## This repository

- `packages/framestack`: the `framestack` CLI (`framestack generate`).
- `packages/eslint`, `error`, `crud`, `kysely-db`, `kysely-db-sqlite`, `kysely-db-pg`, `kysely-db-pglite`: published as `@opentyped/framestack-<folder>`. Apps install only the database driver they use.
- `packages/create-framestack-app`: the CLI. Its template is copied from `example/` at build time.
- `example/`: the reference app that combines the packages; it is what `create` generates.

```sh
npm install
npm run check   # format, typecheck, and the create → install → build → browser test
```
