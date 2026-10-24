import type { Rule } from "eslint";
import { basename } from "node:path";
import {
  appOf,
  conventions,
  inside,
  onImport,
  segments,
  stem,
} from "../paths.js";

/** Forbid importing page, layout, middleware, and other route files. */
export const noConventionImports: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Route convention files are never imported" },
    messages: {
      convention:
        "'{{name}}' is a route file loaded by the router; move shared code into a _private folder or src/lib.",
    },
    schema: [],
  },
  create(context) {
    const app = appOf(context);

    return onImport(context, (node, target) => {
      const path = inside(app, target);
      const name = stem(basename(target));

      // Files inside _private folders are ordinary modules, whatever their name.
      if (
        path !== undefined &&
        conventions.has(name) &&
        !segments(path).some((part) => part.startsWith("_"))
      ) {
        context.report({ node, messageId: "convention", data: { name } });
      }
    });
  },
};
