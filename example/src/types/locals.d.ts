import type { Conn } from "odb/kysely";
import type { Logger } from "pino";

// Types res.locals for handlers and getRequestContext().locals for components.
declare global {
  namespace Express {
    interface Locals {
      db: Conn;
      /** The request's logger, tagged with its client and request ids. */
      log: Logger;
    }
  }
}

export {};
