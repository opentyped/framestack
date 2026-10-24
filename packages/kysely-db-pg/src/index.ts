import { postgres } from "@opentyped/odb-adapters-pg";
import { PostgresDialect } from "kysely";
import pg from "pg";

import { register, sqlState } from "@opentyped/framestack-kysely-db";

/** `postgres://user:password@host:5432/name`; the pool is node-postgres's. */
register<pg.Pool>({
  schemes: ["postgres", "postgresql"],
  open: (url) => new pg.Pool({ connectionString: url }),
  dialect: (pool) => new PostgresDialect({ pool }),
  source: (pool) => postgres({ client: pool }),
  close: (pool) => pool.end(),
  // Constraint violations and other SQLSTATE errors.
  error: sqlState,
});
