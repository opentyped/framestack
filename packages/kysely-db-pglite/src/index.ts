import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { postgres } from "@opentyped/odb-adapters-pg";
import { PostgresDialect, type PostgresPool } from "kysely";

import { register, sqlState } from "@opentyped/framestack-kysely-db";

/** `pglite://data/db` (a data directory) or `pglite://memory`: Postgres in-process. */
register<PGlite>({
  schemes: ["pglite"],
  open: (_url, location) =>
    new PGlite(
      location === "memory" || !location ? undefined : resolve(location),
    ),
  dialect: (pglite) => new PostgresDialect({ pool: pool(pglite) }),
  source: (pglite) => postgres({ client: pglite }),
  close: (pglite) => pglite.close(),
  // Constraint violations and other SQLSTATE errors.
  error: sqlState,
});

/**
 * Present PGlite's single connection as a pg pool. Clients are handed out one
 * at a time, so a transaction never interleaves with another request's queries.
 * Streaming (`.stream()`) is not supported.
 */
function pool(pglite: PGlite): PostgresPool {
  let queue = Promise.resolve();

  return {
    async connect() {
      let release!: () => void;
      const previous = queue;

      queue = new Promise((resolve) => (release = resolve));
      await previous;

      return {
        async query(sql: string, parameters: readonly unknown[]) {
          const result = await pglite.query<Record<string, unknown>>(sql, [
            ...parameters,
          ]);
          // Kysely reads the command to report affected rows.
          const command = (/^\s*(\w+)/.exec(sql)?.[1]?.toUpperCase() ??
            "SELECT") as "SELECT";

          return {
            command,
            rowCount: result.affectedRows ?? result.rows.length,
            rows: result.rows,
          };
        },
        release,
      };
    },
    async end() {},
  } as unknown as PostgresPool;
}
