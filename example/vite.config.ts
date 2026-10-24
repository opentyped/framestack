import { fileURLToPath } from "node:url";

import { openapi } from "@opentyped/oapi-vite";
import { expressRsc } from "@opentyped/vite-express-rsc";
import { defineConfig } from "vite";

import generation from "./oapi.config.ts";

export default defineConfig({
  // `~/` is src/, so imports never climb with ../
  resolve: { alias: { "~": fileURLToPath(new URL("src", import.meta.url)) } },
  plugins: [expressRsc({ directory: "./src/app" }), openapi(generation)],
});
