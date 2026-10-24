// Builds a resource's SELECT: its columns, computed fields, and joins embedded as JSON.
import { CodeError } from "@opentyped/framestack-error";
import type { TableInfo } from "@opentyped/framestack-kysely-db/tables";
import {
  type AliasableExpression,
  type Expression,
  type ExpressionBuilder,
  type Kysely,
  PostgresAdapter,
  type SelectQueryBuilder,
  sql,
  type SqlBool,
  type Transaction,
} from "kysely";
import * as postgres from "kysely/helpers/postgres";
import * as sqlite from "kysely/helpers/sqlite";

import { condition } from "./filters.js";
import type { Filter, Sorter } from "./types.js";

/** The main table's alias in every resource query: refer to its columns as `main.<column>`. */
export const main = "main";

type Db = Kysely<any> | Transaction<any>;
type Builder = ExpressionBuilder<any, any>;
type Select = SelectQueryBuilder<any, any, any>;

/** Pairs of `local column → joined column`; several pairs join on all of them. */
export type On = Readonly<Record<string, string>>;

/** A related table embedded on each row as JSON under the join's name. */
export interface Join<Table extends string = string> {
  /** The related table, by its key in the generated tables. */
  table: Table;
  /** How the main table (or `through`) meets it: `{ user_id: "id" }` is `main.user_id = <join>.id`. */
  on: On;
  /** An intermediate table: `main` meets `through.table` by `through.on`, and that meets `table` by `on`. */
  through?: { table: Table; on: On };
  /** Embedded columns; default every column that is not sensitive. */
  columns?: readonly string[];
  /** Embed every match as an array instead of the first match (or null). */
  many?: boolean;
  /** Extra condition on the joined rows; the joined table is aliased by the join's name. */
  where?: (eb: Builder, context: Context) => Expression<SqlBool>;
  /** Order of a `many` array, e.g. `[{ field: "created_at", order: "desc" }]`. */
  orderBy?: readonly Sorter[];
}

/** What every resource callback receives. */
export interface Context {
  req: import("express").Request;
  res: import("express").Response;
  db: Db;
}

/** A computed field: any expression over `main`, such as a count or a JSON value. */
export type Computed = (
  eb: Builder,
  context: Context,
) => AliasableExpression<unknown>;

/** Everything a resource query needs to know. */
export interface Plan {
  table: TableInfo;
  key: string;
  columns: readonly string[];
  computed: Readonly<Record<string, Computed>>;
  joins: Readonly<Record<string, Join>>;
  tables: Readonly<Record<string, TableInfo>>;
  hidden: ReadonlySet<string>;
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Check a resource definition once, when the router is built. */
export function check(name: string, plan: Plan) {
  const has = (table: TableInfo, column: string) =>
    table.columns.some((info) => info.name === column);
  const tableOf = (key: string) => {
    const table = plan.tables[key];

    if (!table) {
      throw new Error(`crud ${name}: unknown table ${key}`);
    }

    return table;
  };

  for (const column of plan.columns) {
    if (!has(plan.table, column)) {
      throw new Error(`crud ${name}: ${plan.key} has no column ${column}`);
    }
  }

  for (const [field, join] of Object.entries(plan.joins)) {
    if (!identifier.test(field) || field === main) {
      throw new Error(`crud ${name}: invalid join name ${field}`);
    }

    const joined = tableOf(join.table);
    const from = join.through ? tableOf(join.through.table) : plan.table;

    if (join.through) {
      for (const [local, remote] of Object.entries(join.through.on)) {
        if (!has(plan.table, local) || !has(from, remote)) {
          throw new Error(
            `crud ${name}: join ${field} through.on ${local} → ${remote} does not exist`,
          );
        }
      }
    }

    for (const [local, remote] of Object.entries(join.on)) {
      if (!has(from, local) || !has(joined, remote)) {
        throw new Error(
          `crud ${name}: join ${field} on ${local} → ${remote} does not exist`,
        );
      }
    }

    for (const column of join.columns ?? []) {
      if (!has(joined, column)) {
        throw new Error(`crud ${name}: ${join.table} has no column ${column}`);
      }
    }
  }

  for (const field of Object.keys(plan.computed)) {
    if (
      !identifier.test(field) ||
      field in plan.joins ||
      plan.columns.includes(field)
    ) {
      throw new Error(
        `crud ${name}: computed field ${field} clashes or is not a plain name`,
      );
    }
  }
}

/** Columns a join embeds. */
function columnsOf(plan: Plan, join: Join) {
  return (
    join.columns ??
    plan.tables[join.table]!.columns.map((column) => column.name).filter(
      (column) => !plan.hidden.has(column),
    )
  );
}

/** The joined rows correlated with the current `main` row, as a subquery builder. */
function related(
  eb: Builder,
  field: string,
  join: Join,
  context: Context,
): Select {
  const through = `${field}__through`;
  let query: Select = eb.selectFrom(`${join.table} as ${field}`);

  if (join.through) {
    query = query
      .innerJoin(`${join.through.table} as ${through}`, (on) =>
        Object.entries(join.on).reduce(
          (jb: any, [local, remote]) =>
            jb.onRef(`${through}.${local}`, "=", `${field}.${remote}`),
          on,
        ),
      )
      .where((inner: Builder) =>
        inner.and(
          Object.entries(join.through!.on).map(([local, remote]) =>
            inner(
              sql.ref(`${through}.${remote}`),
              "=",
              sql.ref(`${main}.${local}`),
            ),
          ),
        ),
      );
  } else {
    query = query.where((inner: Builder) =>
      inner.and(
        Object.entries(join.on).map(([local, remote]) =>
          inner(
            sql.ref(`${field}.${remote}`),
            "=",
            sql.ref(`${main}.${local}`),
          ),
        ),
      ),
    );
  }

  if (join.where) {
    query = query.where((inner: Builder) => join.where!(inner, context));
  }

  return query;
}

/** A field a filter or sorter may name: a column, a computed field, or `join.column`. */
type Field =
  | { kind: "value"; expression: (eb: Builder) => Expression<unknown> }
  | { kind: "many"; field: string; join: Join; column: string };

/** Resolve a field name from the request, or refuse it. */
function fieldOf(plan: Plan, name: string, context: Context): Field {
  if (plan.columns.includes(name)) {
    return { kind: "value", expression: () => sql.ref(`${main}.${name}`) };
  }

  const computed = plan.computed[name];

  if (computed) {
    return { kind: "value", expression: (eb) => computed(eb, context) };
  }

  const [field = "", column = "", ...rest] = name.split(".");
  const join = plan.joins[field];

  if (join && !rest.length && columnsOf(plan, join).includes(column)) {
    return join.many
      ? { kind: "many", field, join, column }
      : {
          kind: "value",
          expression: (eb) =>
            related(eb, field, join, context)
              .select(sql.ref(`${field}.${column}`).as(column))
              .limit(1),
        };
  }

  throw CodeError.invalid(`unknown field ${name}`);
}

/** `like` is case-insensitive `ilike` on PostgreSQL. */
function likeOf(db: Db) {
  return db.getExecutor().adapter instanceof PostgresAdapter ? "ilike" : "like";
}

/** Apply filters: a `many` join matches when any of its rows does. */
export function where(
  query: Select,
  plan: Plan,
  filters: readonly Filter[],
  context: Context,
): Select {
  if (!filters.length) {
    return query;
  }

  const like = likeOf(context.db);

  return query.where((eb: Builder) =>
    eb.and(
      filters.map((filter) => {
        const field = fieldOf(plan, filter.field, context);

        if (field.kind === "value") {
          return condition(eb, field.expression(eb), filter, like);
        }

        return eb.exists(
          related(eb, field.field, field.join, context)
            .select(sql.lit(1).as("one"))
            .where((inner: Builder) =>
              condition(
                inner,
                sql.ref(`${field.field}.${field.column}`),
                filter,
                like,
              ),
            ),
        );
      }),
    ),
  );
}

/** Apply sorters; `many` joins cannot be sorted on. */
export function orderBy(
  query: Select,
  plan: Plan,
  sorters: readonly Sorter[],
  context: Context,
): Select {
  for (const sorter of sorters) {
    const field = fieldOf(plan, sorter.field, context);

    if (field.kind === "many") {
      throw CodeError.invalid(
        `cannot sort by ${sorter.field}: it has many values`,
      );
    }

    query = query.orderBy((eb: Builder) => field.expression(eb), sorter.order);
  }

  return query;
}

/** The resource's rows: its columns, computed fields, and embedded joins. */
export function select(query: Select, plan: Plan, context: Context): Select {
  const json =
    context.db.getExecutor().adapter instanceof PostgresAdapter
      ? postgres
      : sqlite;

  return query.select((eb: Builder) => [
    ...plan.columns.map((column) => sql.ref(`${main}.${column}`).as(column)),
    ...Object.entries(plan.computed).map(([field, computed]) =>
      computed(eb, context).as(field),
    ),
    ...Object.entries(plan.joins).map(([field, join]) => {
      let rows = related(eb, field, join, context).select(
        columnsOf(plan, join).map((column) =>
          sql.ref(`${field}.${column}`).as(column),
        ),
      );

      if (join.many) {
        for (const sorter of join.orderBy ?? []) {
          rows = rows.orderBy(
            sql.ref(`${field}.${sorter.field}`),
            sorter.order,
          );
        }

        return json.jsonArrayFrom(rows).as(field);
      }

      return json.jsonObjectFrom(rows.limit(1)).as(field);
    }),
  ]);
}

/** SQLite returns embedded JSON as text; give every driver the same objects. */
export function parse(rows: readonly Record<string, unknown>[], plan: Plan) {
  for (const row of rows) {
    for (const field of Object.keys(plan.joins)) {
      if (typeof row[field] === "string") {
        row[field] = JSON.parse(row[field] as string);
      }
    }
  }

  return rows;
}
