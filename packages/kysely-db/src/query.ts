// Run Kysely builders with the same result shapes as raw: query.one(conn.selectFrom("todo")…).
import { CodeError } from "@opentyped/framestack-error";
import type { Simplify } from "kysely";

interface Executor<O> {
  execute(): Promise<Simplify<O>[]>;
}

interface FirstExecutor<O> {
  executeTakeFirst(): Promise<O | undefined>;
}

/** Every row. */
export function any<O>(query: Executor<O>) {
  return query.execute();
}

/** The first row; fails with NotFound when there is none. */
export async function one<O>(query: FirstExecutor<O>): Promise<O> {
  const row = await query.executeTakeFirst();

  if (row === undefined) {
    throw CodeError.notfound("row");
  }

  return row;
}

/** The first row, or null. */
export async function maybeOne<O>(query: FirstExecutor<O>): Promise<O | null> {
  return (await query.executeTakeFirst()) ?? null;
}
