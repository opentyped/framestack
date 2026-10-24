// Filters and sorters, in refine's shape, compiled to Kysely expressions.
import { CodeError } from "@opentyped/framestack-error";

import {
  type Filter,
  type Operator,
  operators,
  type Sorter,
  type Value,
} from "./types.js";
import {
  type Expression,
  type ExpressionBuilder,
  sql,
  type SqlBool,
} from "kysely";

/** Read and check filters from untrusted input; fields are checked when the query is built. */
export function parseFilters(input: unknown): Filter[] {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw CodeError.invalid("filters must be an array");
  }

  return input.map((item: Partial<Filter>) => {
    if (typeof item?.field !== "string") {
      throw CodeError.invalid(`cannot filter by ${String(item?.field)}`);
    }

    if (!operators.includes(item.operator as Operator)) {
      throw CodeError.invalid(`unsupported operator ${String(item.operator)}`);
    }

    const list = item.operator === "in" || item.operator === "nin";
    const values = Array.isArray(item.value) ? item.value : [item.value];

    if (
      list !== Array.isArray(item.value) &&
      !item.operator!.includes("null")
    ) {
      throw CodeError.invalid(
        `${item.operator} expects ${list ? "a list" : "one value"}`,
      );
    }

    if (
      !values.every(
        (value) =>
          value === null ||
          ["string", "number", "boolean"].includes(typeof value),
      )
    ) {
      throw CodeError.invalid(`invalid value for ${item.field}`);
    }

    return item as Filter;
  });
}

/** Read `name.asc,user.name.desc`; the order defaults to `asc`. */
export function parseSorters(input: unknown): Sorter[] {
  if (typeof input !== "string" || !input) {
    return [];
  }

  return input.split(",").map((part) => {
    // `user.name` sorts ascending; `user.name.desc` names the order.
    const match = /^(.+?)(?:\.(asc|desc))?$/.exec(part);
    const field = match?.[1] ?? "";
    const order = (match?.[2] ?? "asc") as "asc" | "desc";

    if (!field) {
      throw CodeError.invalid(`cannot sort by ${part}`);
    }

    return { field, order };
  });
}

/** One filter on `column` (a column or any expression) as a WHERE condition. `like` is `ilike` on PostgreSQL. */
export function condition(
  eb: ExpressionBuilder<any, any>,
  column: Expression<unknown>,
  filter: Filter,
  like: "like" | "ilike",
): Expression<SqlBool> {
  const value = filter.value as never;
  const pattern = (value: unknown) =>
    `%${String(value).replace(/[\\%_]/g, "\\$&")}%`;

  switch (filter.operator) {
    case "eq":
      return eb(column, "=", value);
    case "ne":
      return eb(column, "<>", value);
    case "lt":
      return eb(column, "<", value);
    case "gt":
      return eb(column, ">", value);
    case "lte":
      return eb(column, "<=", value);
    case "gte":
      return eb(column, ">=", value);
    case "in":
      return (filter.value as Value[]).length
        ? eb(column, "in", value)
        : sql<SqlBool>`1 = 0`;
    case "nin":
      return (filter.value as Value[]).length
        ? eb(column, "not in", value)
        : sql<SqlBool>`1 = 1`;
    case "contains":
      return sql<SqlBool>`${column} ${sql.raw(like)} ${pattern(filter.value)} escape '\\'`;
    case "ncontains":
      return sql<SqlBool>`${column} not ${sql.raw(like)} ${pattern(filter.value)} escape '\\'`;
    case "null":
      return eb(column, "is", null);
    case "nnull":
      return eb(column, "is not", null);
  }
}
