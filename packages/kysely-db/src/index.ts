import { AsyncLocalStorage } from "node:async_hooks";

import type { Source } from "@opentyped/odb-db";
import { CodeError, ErrorCode } from "@opentyped/framestack-error";
import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  Driver as KyselyDriver,
  Transaction,
} from "kysely";
import { Kysely } from "kysely";

export * as query from "./query.js";
export * as raw from "./raw.js";
export { sql } from "kysely";

/** A logger with pino's call shape: `log.debug({ ...fields }, "message")`. */
export interface Logger {
  debug(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}

/** Values of the current request, read by the database logger. */
export interface Scope {
  log?: Logger;
}

/**
 * The request scope. Enter it once per request (`store.run({ log }, next)`);
 * queries and logs made anywhere during that request see it.
 */
export const store = new AsyncLocalStorage<Scope>();

/** How framestack opens, queries, and introspects one kind of database. */
export interface Driver<Handle = unknown> {
  /** URL schemes this driver accepts, e.g. `["postgres", "postgresql"]`. */
  schemes: readonly string[];
  /** Open the pool or database file. `location` is the URL without its scheme. */
  open(url: string, location: string): Handle;
  dialect(handle: Handle): Dialect;
  /** Read the schema for model generation. */
  source(handle: Handle): Source;
  close(handle: Handle): Promise<void>;
  /** The driver's error as a CodeError, e.g. a unique violation as AlreadyExists. */
  error(error: unknown): CodeError | undefined;
}

/** An open pool, ready to hand to {@link database}. */
export interface Pool<Handle = unknown> {
  url: string;
  driver: Driver<Handle>;
  handle: Handle;
  close(): Promise<void>;
}

const drivers = new Map<string, Driver<never>>();

/** Make a driver available to {@link connect}; driver modules call this on import. */
export function register<Handle>(driver: Driver<Handle>) {
  for (const scheme of driver.schemes) {
    drivers.set(scheme, driver as Driver<never>);
  }
}

/** Split `scheme://location` and find its registered driver. */
export function driverOf(url: string): { driver: Driver; location: string } {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url);

  if (!match) {
    throw new Error(`DB_URL must look like scheme://location, got "${url}"`);
  }

  const driver = drivers.get(match[1]!.toLowerCase());

  if (!driver) {
    throw new Error(
      `No database driver for ${match[1]}://; import one, e.g. "@opentyped/framestack-kysely-db-${match[1] === "sqlite" ? "sqlite" : match[1] === "pglite" ? "pglite" : "pg"}"`,
    );
  }

  return { driver: driver as Driver, location: match[2]! };
}

/** Open a pool for a database URL (`sqlite://`, `postgres://`, `pglite://`). */
export function connect(url: string): Pool {
  const { driver, location } = driverOf(url);
  const handle = driver.open(url, location);

  return { url, driver, handle, close: () => driver.close(handle) };
}

/** Keep logged SQL readable. */
const clip = (sql: string) =>
  sql.length > 1000 ? sql.slice(0, 1000) + "…" : sql;

/**
 * A Kysely instance over the pool. Each query is logged on the request's
 * logger (from {@link store}) when there is one, else on `logger`.
 */
export function database<DB>(pool: Pool, options: { logger?: Logger } = {}) {
  return new Kysely<DB>({
    dialect: coded(pool.driver.dialect(pool.handle), pool.driver),
    log(event) {
      const log = store.getStore()?.log ?? options.logger;
      const fields = {
        sql: clip(event.query.sql),
        ms: Math.round(event.queryDurationMillis),
      };

      if (event.level === "error") {
        log?.error({ ...fields, err: event.error }, "query failed");
      } else {
        log?.debug(fields, "query");
      }
    },
  });
}

/** The dialect, with every query error rethrown as the driver's CodeError. */
function coded(dialect: Dialect, driver: Driver): Dialect {
  const rethrow = (error: unknown): never => {
    throw driver.error(error) ?? error;
  };
  // Kysely hands wrapped connections back to the driver; give the driver its own.
  const unwrapped = new WeakMap<DatabaseConnection, DatabaseConnection>();
  const wrap = (inner: DatabaseConnection): DatabaseConnection => {
    const outer: DatabaseConnection = {
      // Some drivers throw synchronously, so await rather than .catch().
      async executeQuery<R>(query: CompiledQuery) {
        try {
          return await inner.executeQuery<R>(query);
        } catch (error) {
          return rethrow(error);
        }
      },
      async *streamQuery(query, chunkSize) {
        try {
          yield* inner.streamQuery(query, chunkSize);
        } catch (error) {
          rethrow(error);
        }
      },
    };

    unwrapped.set(outer, inner);
    return outer;
  };
  const own = (outer: DatabaseConnection) => unwrapped.get(outer) ?? outer;

  return {
    createAdapter: () => dialect.createAdapter(),
    createIntrospector: (db) => dialect.createIntrospector(db),
    createQueryCompiler: () => dialect.createQueryCompiler(),
    createDriver(): KyselyDriver {
      const inner = dialect.createDriver();
      const driver: KyselyDriver = {
        init: () => inner.init(),
        destroy: () => inner.destroy(),
        acquireConnection: async () => wrap(await inner.acquireConnection()),
        async beginTransaction(conn, settings) {
          try {
            await inner.beginTransaction(own(conn), settings);
          } catch (error) {
            rethrow(error);
          }
        },
        async commitTransaction(conn) {
          try {
            await inner.commitTransaction(own(conn));
          } catch (error) {
            rethrow(error);
          }
        },
        rollbackTransaction: (conn) => inner.rollbackTransaction(own(conn)),
        releaseConnection: (conn) => inner.releaseConnection(own(conn)),
      };

      if (inner.savepoint) {
        driver.savepoint = (conn, name, compile) =>
          inner.savepoint!(own(conn), name, compile);
      }
      if (inner.rollbackToSavepoint) {
        driver.rollbackToSavepoint = (conn, name, compile) =>
          inner.rollbackToSavepoint!(own(conn), name, compile);
      }
      if (inner.releaseSavepoint) {
        driver.releaseSavepoint = (conn, name, compile) =>
          inner.releaseSavepoint!(own(conn), name, compile);
      }

      return driver;
    },
  };
}

/** SQLSTATE errors of PostgreSQL drivers (pg, PGlite) as CodeErrors. */
export function sqlState(error: unknown): CodeError | undefined {
  const value = error as {
    code?: unknown;
    message?: string;
    table?: string;
    column?: string;
    constraint?: string;
  } | null;

  if (typeof value?.code !== "string" || !/^[0-9A-Z]{5}$/.test(value.code)) {
    return undefined;
  }

  const code =
    {
      "23505": ErrorCode.AlreadyExists,
      "23503": ErrorCode.FailedPrecondition,
      "23502": ErrorCode.InvalidArgument,
      "23514": ErrorCode.InvalidArgument,
      "22P02": ErrorCode.InvalidArgument,
      "22001": ErrorCode.InvalidArgument,
      "40001": ErrorCode.Aborted,
      "40P01": ErrorCode.Aborted,
      "57014": ErrorCode.Canceled,
    }[value.code] ?? ErrorCode.Internal;

  return new CodeError(
    code,
    {
      reason: "database",
      message: code === ErrorCode.Internal ? "database error" : value.message,
      sqlState: value.code,
      table: value.table,
      column: value.column,
      constraint: value.constraint,
    },
    { cause: error },
  );
}

/** Run `fn` in a transaction, or inside the caller's transaction if there is one. */
export function begin<DB, T>(
  db: Kysely<DB> | Transaction<DB>,
  fn: (tx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.isTransaction
    ? fn(db as Transaction<DB>)
    : db.transaction().execute(fn);
}
