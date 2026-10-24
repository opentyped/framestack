// Drivers register their URL scheme; import the ones DB_URL may use.
import "@opentyped/framestack-kysely-db-sqlite";

import { connect } from "@opentyped/framestack-kysely-db";

import { env } from "~/env";

/** The connection pool. Kysely and logging are set up per app in src/index.ts. */
export const pool = connect(env.DB_URL);
