import { CodeError } from "@opentyped/framestack-error";
import type { TableInfo } from "@opentyped/framestack-kysely-db/tables";
import express, {
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from "express";
import type { Kysely, SelectQueryBuilder, Transaction } from "kysely";

import { parseFilters, parseSorters } from "./filters.js";
import {
  check,
  type Computed,
  type Context,
  type Join,
  main,
  orderBy,
  parse,
  type Plan,
  select,
  where,
} from "./query.js";

export type { Filter, Operator, Sorter, Value } from "./types.js";
export type { Computed, Context, Join, On } from "./query.js";
export { main };

/** Columns never returned, filtered, sorted, or written, unless a resource lists them in `columns`. */
export const sensitive = ["password", "secret", "token", "key"];

type Row = Record<string, unknown>;
type Middlewares = RequestHandler | readonly RequestHandler[];

/** Narrow the resource's rows for one request: `qb.where("main.owner_id", "=", res.locals.user.id)`. */
export type Scope = (
  query: SelectQueryBuilder<any, any, any>,
  context: Context,
) => SelectQueryBuilder<any, any, any>;

/** Options shared by every action. */
export interface Action {
  /** Run before this action, after the resource's middlewares. */
  middlewares?: Middlewares;
  /** Narrow the rows this action sees, after the resource's `query`. */
  query?: Scope;
}

/** Options of create and update. */
export interface Write extends Action {
  /** Writable columns; default every visible column that is not generated. */
  columns?: readonly string[];
  /** Validate or transform the input (e.g. with zod); throw to reject. */
  validate?: (input: Row, context: Context) => Row | Promise<Row>;
}

/** One resource: `/<name>` and `/<name>/:id`. Actions not listed are not served. */
export interface Resource<Table extends string = string> {
  /** The table, by its key in the generated tables. */
  table: Table;
  /** Returned (and filterable, sortable) columns; default every column that is not {@link sensitive}. */
  columns?: readonly string[];
  /** Computed fields, filterable and sortable by name: `{ todos: (eb) => eb.selectFrom(...)... }`. */
  select?: Readonly<Record<string, Computed>>;
  /** Related rows, embedded as JSON by name; filter and sort on them as `name.column`. */
  joins?: Readonly<Record<string, Join<Table>>>;
  /** Narrow every action's rows, including updates and deletes. */
  query?: Scope;
  /** Run before every action of this resource. */
  middlewares?: Middlewares;
  /** Largest page size; default the router's. */
  maxLimit?: number;
  actions: {
    list?: true | Action;
    show?: true | Action;
    create?: true | Write;
    update?: true | Write;
    /** Delete by id, and many by `{ filters }` in the body. */
    delete?: true | Action;
  };
}

export interface CrudOptions<
  Tables extends Readonly<Record<string, TableInfo>>,
> {
  /** Generated table info (`src/types/tables.ts`). */
  tables: Tables;
  /** Resources by URL name. Tables not listed are not reachable. */
  resources: Readonly<Record<string, Resource<keyof Tables & string>>>;
  /** Run before every resource. */
  middlewares?: Middlewares;
  /** The request's database; default `res.locals.db`. */
  db?: (req: Request, res: Response) => Kysely<any> | Transaction<any>;
  /** Largest page size. Default 100. */
  maxLimit?: number;
}

const list = (middlewares: Middlewares | undefined) =>
  middlewares === undefined
    ? []
    : Array.isArray(middlewares)
      ? [...middlewares]
      : [middlewares as RequestHandler];

/**
 * A router serving each resource at `/<name>` (list, create, delete many) and
 * `/<name>/:id` (show, update, delete), in refine's REST shape
 * (`{ data, total }`). It performs no authentication: add middlewares.
 */
export function crud<Tables extends Readonly<Record<string, TableInfo>>>(
  options: CrudOptions<Tables>,
): Router {
  const router = Router();
  const dbOf = options.db ?? ((_req, res) => res.locals.db as Kysely<any>);

  router.use(express.json(), ...list(options.middlewares));

  for (const [name, resource] of Object.entries(options.resources)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new Error(`crud: invalid resource name ${name}`);
    }

    const table = options.tables[resource.table];

    if (!table) {
      throw new Error(`crud ${name}: unknown table ${resource.table}`);
    }

    const hidden = new Set(sensitive);
    const plan: Plan = {
      table,
      key: resource.table,
      columns:
        resource.columns ??
        table.columns
          .map((column) => column.name)
          .filter((column) => !hidden.has(column)),
      computed: resource.select ?? {},
      joins: resource.joins ?? {},
      tables: options.tables,
      hidden,
    };

    check(name, plan);
    mount(router, name, resource, plan, {
      dbOf,
      maxLimit: resource.maxLimit ?? options.maxLimit ?? 100,
    });
  }

  return router;
}

/** Register one resource's routes. */
function mount(
  router: Router,
  name: string,
  resource: Resource,
  plan: Plan,
  {
    dbOf,
    maxLimit,
  }: { dbOf: NonNullable<CrudOptions<any>["db"]>; maxLimit: number },
) {
  const { table } = plan;
  const actionOf = <A extends keyof Resource["actions"]>(action: A) => {
    const value = resource.actions[action];

    return (value === true ? {} : value) as Exclude<
      NonNullable<Resource["actions"][A]>,
      true
    >;
  };
  const handlers = (action: Action) => [
    ...list(resource.middlewares),
    ...list(action.middlewares),
  ];
  const contextOf = (req: Request, res: Response): Context => ({
    req,
    res,
    db: dbOf(req, res),
  });

  /** The resource's rows for this action, narrowed by both scopes (unless `unscoped`). */
  const rows = (context: Context, action: Action, unscoped = false) => {
    let query = context.db.selectFrom(`${plan.key} as ${main}`);

    if (unscoped) {
      return query;
    }

    if (resource.query) {
      query = resource.query(query, context);
    }

    if (action.query) {
      query = action.query(query, context);
    }

    return query;
  };

  /** The single-column primary key, with the id parsed to the column's type. */
  const key = (id: string) => {
    if (table.primaryKey.length !== 1) {
      throw CodeError.precondition(`${name} has no single-column primary key`);
    }

    const column = table.columns.find(
      (column) => column.name === table.primaryKey[0],
    )!;
    const numeric = /int|serial|numeric|real|double|float/i.test(column.type);

    if (numeric && !/^-?\d+(\.\d+)?$/.test(id)) {
      throw CodeError.notfound(name);
    }

    return { column: column.name, value: numeric ? Number(id) : id };
  };

  /** Read rows by primary key with every field, as the response returns them. */
  const read = async (
    context: Context,
    action: Action,
    ids: unknown[],
    unscoped = false,
  ) => {
    const { column } = key("0");
    const found = parse(
      await select(rows(context, action, unscoped), plan, context)
        .where(`${main}.${column}`, "in", ids)
        .execute(),
      plan,
    );

    return ids.map((id) => found.find((row) => row[column] === id));
  };

  /** Keep only writable columns, then validate. */
  const writable = async (input: unknown, write: Write, context: Context) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw CodeError.invalid("expected a JSON object");
    }

    const allowed =
      write.columns ??
      plan.columns.filter(
        (column) =>
          !table.columns.find((info) => info.name === column)?.generated,
      );
    const row = Object.fromEntries(Object.entries(input));

    for (const field of Object.keys(row)) {
      if (!allowed.includes(field)) {
        throw CodeError.invalid(`cannot write ${field}`);
      }
    }

    return write.validate ? write.validate(row, context) : row;
  };

  if (resource.actions.list) {
    const action = actionOf("list");

    // List with filters (JSON in ?filters=, base64 or plain), sort, and paging.
    router.get(`/${name}`, ...handlers(action), async (req, res) => {
      const context = contextOf(req, res);
      const raw =
        typeof req.query.filters === "string" ? req.query.filters : undefined;
      const filters = parseFilters(raw === undefined ? undefined : decode(raw));
      const sorters = parseSorters(req.query.sort);
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const limit = Math.min(
        maxLimit,
        Math.max(1, Number(req.query.limit ?? 10) || 10),
      );
      const filtered = where(rows(context, action), plan, filters, context);
      const [data, count] = await Promise.all([
        orderBy(select(filtered, plan, context), plan, sorters, context)
          .offset(offset)
          .limit(limit)
          .execute(),
        filtered
          .select((eb) => eb.fn.countAll().as("count"))
          .executeTakeFirstOrThrow(),
      ]);

      res.json({ data: parse(data, plan), total: Number(count.count) });
    });
  }

  if (resource.actions.show) {
    const action = actionOf("show");

    router.get(`/${name}/:id`, ...handlers(action), async (req, res) => {
      const context = contextOf(req, res);
      const [data] = await read(context, action, [
        key(String(req.params.id)).value,
      ]);

      if (!data) {
        throw CodeError.notfound(name);
      }

      res.json({ data });
    });
  }

  if (resource.actions.create) {
    const action = actionOf("create");

    // One object, or an array for createMany.
    router.post(`/${name}`, ...handlers(action), async (req, res) => {
      const context = contextOf(req, res);
      const many = Array.isArray(req.body);
      const items: unknown[] = many ? req.body : [req.body];

      if (!items.length) {
        throw CodeError.invalid("no rows");
      }

      const values = await Promise.all(
        items.map((item) => writable(item, action, context)),
      );
      const { column } = key("0");
      const inserted = await context.db
        .insertInto(plan.key)
        .values(values)
        .returning(column)
        .execute();
      // New rows are read back without the scopes: they may fall outside them.
      const data = await read(
        context,
        action,
        inserted.map((row) => row[column]),
        true,
      );

      res.status(201).json({ data: many ? data : data[0] });
    });
  }

  /** The id's row, if this action's scopes let the request see it. */
  const visible = async (context: Context, action: Action, id: string) => {
    const { column, value } = key(id);
    const row = await rows(context, action)
      .select(`${main}.${column}`)
      .where(`${main}.${column}`, "=", value)
      .executeTakeFirst();

    if (!row) {
      throw CodeError.notfound(name);
    }

    return { column, value };
  };

  if (resource.actions.update) {
    const action = actionOf("update");

    router.patch(`/${name}/:id`, ...handlers(action), async (req, res) => {
      const context = contextOf(req, res);
      const changes = await writable(req.body, action, context);

      if (!Object.keys(changes).length) {
        throw CodeError.invalid("no fields to update");
      }

      const { column, value } = await visible(
        context,
        action,
        String(req.params.id),
      );

      await context.db
        .updateTable(plan.key)
        .set(changes)
        .where(column, "=", value)
        .execute();

      const [data] = await read(context, action, [value]);

      res.json({ data });
    });
  }

  if (resource.actions.delete) {
    const action = actionOf("delete");

    router.delete(`/${name}/:id`, ...handlers(action), async (req, res) => {
      const context = contextOf(req, res);
      const { column, value } = await visible(
        context,
        action,
        String(req.params.id),
      );
      const [data] = await read(context, action, [value]);

      await context.db.deleteFrom(plan.key).where(column, "=", value).execute();
      res.json({ data });
    });

    // deleteMany: `{ filters }` in the body; at least one filter is required.
    router.delete(`/${name}`, ...handlers(action), async (req, res) => {
      const context = contextOf(req, res);
      const filters = parseFilters(
        (req.body as { filters?: unknown })?.filters,
      );

      if (!filters.length) {
        throw CodeError.invalid("deleting many rows needs at least one filter");
      }

      const { column } = key("0");
      const data = parse(
        await select(
          where(rows(context, action), plan, filters, context),
          plan,
          context,
        ).execute(),
        plan,
      );

      if (data.length) {
        await context.db
          .deleteFrom(plan.key)
          .where(
            column,
            "in",
            data.map((row) => row[column]),
          )
          .execute();
      }

      res.json({ data });
    });
  }
}

/** `?filters=` as JSON, optionally base64-encoded (refine's data provider does this). */
function decode(value: string): unknown {
  for (const text of [value, Buffer.from(value, "base64").toString("utf8")]) {
    try {
      return JSON.parse(text);
    } catch {
      // Try the next encoding.
    }
  }

  throw CodeError.invalid("filters must be JSON");
}
