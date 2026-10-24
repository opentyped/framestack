import js from "@eslint/js";
import type { ESLint, Linter } from "eslint";
import prettier from "eslint-plugin-prettier/recommended";
import sort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

import { absoluteImports } from "./rules/absolute.js";
import { noConventionImports } from "./rules/conventions.js";
import { filenames } from "./rules/filenames.js";
import { importScope } from "./rules/scope.js";

/** framestack's layout rules for src/. */
export const plugin: ESLint.Plugin = {
  meta: { name: "@opentyped/framestack-eslint" },
  rules: {
    "absolute-imports": absoluteImports,
    filenames,
    "no-convention-imports": noConventionImports,
    "import-scope": importScope,
  },
};

/** The full framestack config, like eslint-config-next: spread it into eslint.config.js. */
const config: Linter.Config[] = [
  { name: "framestack/ignores", ignores: ["dist/", "**/*.d.ts", "src/types/"] },
  js.configs.recommended,
  ...(tseslint.configs.recommended as Linter.Config[]),
  {
    name: "framestack/typescript",
    plugins: { "simple-import-sort": sort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      // `declare global { namespace Express { … } }` is how Express is typed.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      // Express error handlers need all four parameters; `_next` marks it unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Names, ~/ imports, route files, and import direction in src/.
    name: "framestack/layout",
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    ignores: ["src/types/**"],
    plugins: { framestack: plugin },
    rules: {
      "framestack/absolute-imports": "error",
      "framestack/filenames": "error",
      "framestack/no-convention-imports": "error",
      "framestack/import-scope": "error",
    },
  },
  prettier,
];

export default config;
