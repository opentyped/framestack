import type { Rule } from "eslint";
import { dirname } from "node:path";
import { appOf, inside, onImport, segments } from "../paths.js";

/** The route folder a module belongs to: its folder without trailing `_private` parts. */
function scopeOf(path: string): string[] {
  const parts = segments(dirname(path));
  const index = parts.findIndex((part) => part.startsWith("_"));

  return index < 0 ? parts : parts.slice(0, index);
}

/**
 * Inside src/app, a module may import only from its own route folder or its
 * ancestors: deeper code may use shallower code, never the reverse or a sibling.
 * Code outside src/app never imports from it.
 */
export const importScope: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Import only from the same or an ancestor route" },
    messages: {
      deeper:
        "'{{target}}' belongs to /{{scope}}; it can be imported only from there or deeper.",
      outside: "Code outside src/app cannot import from src/app.",
    },
    schema: [],
  },
  create(context) {
    const app = appOf(context);
    const importer = inside(app, context.filename);

    return onImport(context, (node, target) => {
      const path = inside(app, target);

      if (path === undefined) {
        return;
      }

      if (importer === undefined) {
        context.report({ node, messageId: "outside" });
        return;
      }

      const scope = scopeOf(path);
      const from = segments(dirname(importer));

      if (!scope.every((part, i) => from[i] === part)) {
        context.report({
          node,
          messageId: "deeper",
          data: { target: path, scope: scope.join("/") },
        });
      }
    });
  },
};
