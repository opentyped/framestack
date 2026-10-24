import type { Rule } from "eslint";
import { resolve } from "node:path";
import { inside, segments } from "../paths.js";

const word = "[a-z][a-z0-9]*";
// Folders: `name`, private `_name`, group `(name)`, params `[name]` and `[...name]`.
const folder = new RegExp(
  `^(${word}|_${word}|\\(${word}\\)|\\[(\\.\\.\\.)?${word}\\])$`,
);
// Files: `name.ext` or a test `name_test.ext`; extensions are lowercase too.
const file = new RegExp(`^${word}(_test)?(\\.[a-z0-9]+)+$`);
// Model files are named after their SQL table, e.g. `auth_user.ts`.
const model = /^[a-z][a-z0-9_]*(\.[a-z0-9]+)+$/;

/** Require single lowercase words for every folder and file below src/. */
export const filenames: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Use single lowercase words for files and folders" },
    messages: {
      folder:
        "Folder '{{name}}' must be one lowercase word (or _private, (group), [param], [...rest]).",
      file: "File '{{name}}' must be one lowercase word, e.g. 'button.tsx'.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const path = inside(resolve(context.cwd, "src"), context.filename);

        if (path === undefined) {
          return;
        }

        const parts = segments(path);
        const name = parts.pop()!;

        for (const part of parts) {
          if (!folder.test(part)) {
            context.report({ node, messageId: "folder", data: { name: part } });
          }
        }

        const valid = parts[0] === "models" ? model : file;

        if (!valid.test(name)) {
          context.report({ node, messageId: "file", data: { name } });
        }
      },
    };
  },
};
