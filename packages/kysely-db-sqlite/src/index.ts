import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { sqlite } from "@opentyped/odb-adapters-sqlite";
import { SqliteDialect } from "kysely";

import { CodeError, ErrorCode } from "@opentyped/framestack-error";
import { register } from "@opentyped/framestack-kysely-db";

/** SQLite extended result codes for constraint violations. */
const constraints: Record<number, ErrorCode> = {
  2067: ErrorCode.AlreadyExists, // UNIQUE
  1555: ErrorCode.AlreadyExists, // PRIMARY KEY
  787: ErrorCode.FailedPrecondition, // FOREIGN KEY
  1299: ErrorCode.InvalidArgument, // NOT NULL
  275: ErrorCode.InvalidArgument, // CHECK
};

/** node:sqlite errors as CodeErrors. */
function sqliteError(error: unknown): CodeError | undefined {
  const value = error as {
    code?: unknown;
    errcode?: unknown;
    message?: string;
  };

  if (value?.code !== "ERR_SQLITE_ERROR" || typeof value.errcode !== "number") {
    return undefined;
  }

  const code = constraints[value.errcode] ?? ErrorCode.Internal;

  return new CodeError(
    code,
    {
      reason: "database",
      message: code === ErrorCode.Internal ? "database error" : value.message,
    },
    { cause: error },
  );
}

/** `sqlite://app.db` (relative to the working directory), `sqlite:///abs/app.db`, or `sqlite://:memory:`. */
register<DatabaseSync>({
  schemes: ["sqlite"],
  open: (_url, location) =>
    new DatabaseSync(location === ":memory:" ? location : resolve(location)),
  dialect: (database) => new SqliteDialect({ database: adapt(database) }),
  source: (database) => sqlite({ database }),
  async close(database) {
    if (database.isOpen) {
      database.close();
    }
  },
  error: sqliteError,
});

/**
 * Adapt Node's built-in `node:sqlite` to Kysely's SQLite dialect, which expects
 * better-sqlite3's statement shape. No native dependency is needed.
 */
function adapt(database: DatabaseSync) {
  return {
    close: () => database.close(),
    prepare(sql: string) {
      const statement = database.prepare(sql);
      const values = (parameters: ReadonlyArray<unknown>) =>
        parameters as SQLInputValue[];
      // node:sqlite rows have a null prototype; React only serializes plain objects.
      const plain = (row: object) => ({ ...row });

      return {
        reader: statement.columns().length > 0,
        all: (parameters: ReadonlyArray<unknown>) =>
          statement.all(...values(parameters)).map(plain),
        run: (parameters: ReadonlyArray<unknown>) =>
          statement.run(...values(parameters)),
        *iterate(parameters: ReadonlyArray<unknown>) {
          for (const row of statement.iterate(...values(parameters))) {
            yield plain(row);
          }
        },
      };
    },
  };
}
