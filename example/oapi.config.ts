import { defineConfig } from "@opentyped/oapi-compiler";
import { defaultParsers } from "@opentyped/oapi-vite";
import { filesystemParsers } from "@opentyped/vite-express-rsc-oapi";

// OpenAPI generation: Vite regenerates these files on every build and on save in dev.
// Handlers in src/app become operations; database models become schemas.
export default defineConfig({
  tsconfig: "tsconfig.json",
  info: { title: "Todos", version: "1.0.0" },
  // Name schemas after the database models (`models.Todo`) instead of their file path.
  namespaces: { "./src/models/**/*.ts": "models" },
  parsers: filesystemParsers({ directory: "src/app" }, defaultParsers()),
  output: {
    document: "src/types/openapi.json",
    declarations: "src/types/openapi.d.ts",
  },
});
