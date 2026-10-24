import type { RequestHandler } from "express";

import document from "~/types/openapi.json";

/** Serve the OpenAPI document that Vite generates on build (see oapi.config.ts). */
export const GET: RequestHandler = (_req, res) => {
  res.json(document);
};
