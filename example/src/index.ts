import { randomUUID } from "node:crypto";

import { CodeError } from "@opentyped/framestack-error";
import { database, store } from "@opentyped/framestack-kysely-db";
import express, { type ErrorRequestHandler } from "express";
import app from "express/rsc/bundle";
import type { Database } from "odb/kysely";
import pino from "pino";

import { env } from "~/env";
import { pool } from "~/lib/db";

const logger = pino({ level: env.LOG_LEVEL });
// Queries log on the current request's logger (see the scope below).
const db = database<Database>(pool, { logger });
const server = express();

server.use(express.json());

// Give every request a logger tagged with its client and request ids, and enter
// the request scope so queries made while handling it carry the same tags.
server.use((req, res, next) => {
  const log = logger.child({
    clientId: req.get("x-client-id"),
    requestId: req.get("x-request-id") ?? randomUUID(),
  });

  res.locals.db = db;
  res.locals.log = log;
  store.run({ log }, next);
});

server.use(app);

// Last: every error is answered as a CodeError.
server.use(((error, _req, res, _next) => {
  const coded = CodeError.from(error);
  res.status(coded.status).json(coded.toJSON());
}) satisfies ErrorRequestHandler);

server.listen(env.PORT, () => logger.info(`http://localhost:${env.PORT}`));
