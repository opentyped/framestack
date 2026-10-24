import type { Rule } from "eslint";

import { onImport } from "../paths.js";

/** Require `~/` imports instead of climbing out of a folder with `../`. */
export const absoluteImports: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Import through ~/ instead of ../" },
    messages: { parent: "Import '{{source}}' through ~/ instead of ../." },
    schema: [],
  },
  create(context) {
    return onImport(context, (node) => {
      const source = (node as { value?: unknown }).value;

      if (typeof source === "string" && source.startsWith("../")) {
        context.report({ node, messageId: "parent", data: { source } });
      }
    });
  },
};
