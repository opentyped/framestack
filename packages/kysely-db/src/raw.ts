// Plain SQL with typed rows: raw.any(conn, sql`select * from todo where done = ${0}`).
import { CodeError } from "@opentyped/framestack-error";
import type { QueryExecutorProvider, QueryResult, RawBuilder } from "kysely";

export { sql } from "kysely";

/** Run a statement and return Kysely's full result. */
export function execute<T>(
  conn: QueryExecutorProvider,
  query: RawBuilder<T>,
): Promise<QueryResult<T>> {
  return query.execute(conn);
}

/** Every row. */
export async function any<T>(
  conn: QueryExecutorProvider,
  query: RawBuilder<T>,
) {
  return (await query.execute(conn)).rows;
}

/** The first row; fails with NotFound when there is none. */
export async function one<T>(
  conn: QueryExecutorProvider,
  query: RawBuilder<T>,
) {
  const [row] = (await query.execute(conn)).rows;

  if (row === undefined) {
    throw CodeError.notfound("row");
  }

  return row;
}

/** The first row, or null. */
export async function maybeOne<T>(
  conn: QueryExecutorProvider,
  query: RawBuilder<T>,
) {
  return (await query.execute(conn)).rows[0] ?? null;
}
