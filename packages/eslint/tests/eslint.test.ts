import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { plugin } from "../dist/index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester();
const rules = plugin.rules!;
/** An absolute path in the project the rules lint. */
const at = (path: string) => resolve(process.cwd(), path);
const code = `export {};`;

tester.run("filenames", rules.filenames as never, {
  valid: [
    "src/index.ts",
    "src/lib/db.ts",
    "src/models/main.d.ts",
    "src/app/page.tsx",
    "src/app/(shop)/cart/page.tsx",
    "src/app/todos/[id]/page.tsx",
    "src/app/docs/[...slug]/page.tsx",
    "src/app/home/_components/button.tsx",
    "src/lib/db_test.ts",
    "src/models/auth_user.ts",
    // Outside src/ nothing is checked.
    "vite.config.ts",
    "scripts/Generate-Types.ts",
  ].map((path) => ({ code, filename: at(path) })),
  invalid: [
    ["src/app/TodoForm.tsx", "file"],
    ["src/lib/date-utils.ts", "file"],
    ["src/lib/date_utils.ts", "file"],
    ["src/models/AuthUser.ts", "file"],
    ["src/app/user-settings/page.tsx", "folder"],
    ["src/app/Components/button.tsx", "folder"],
    ["src/app/__private/button.tsx", "folder"],
    ["src/app/[userId]/page.tsx", "folder"],
  ].map(([path, messageId]) => ({
    code,
    filename: at(path!),
    errors: [{ messageId: messageId! }],
  })),
});

tester.run("no-convention-imports", rules["no-convention-imports"] as never, {
  valid: [
    {
      code: `import "./_components/page";`,
      filename: at("src/app/home/page.tsx"),
    },
    { code: `import "./form";`, filename: at("src/app/page.tsx") },
    { code: `import "../lib/page";`, filename: at("src/app/page.tsx") },
  ],
  invalid: [
    `import Page from "./page";`,
    `import { loader } from "./home/page.tsx";`,
    `export * from "./layout";`,
    `const m = import("./middleware");`,
    `import { GET } from "./api/route";`,
  ].map((source) => ({
    code: source,
    filename: at("src/app/form.tsx"),
    errors: [{ messageId: "convention" }],
  })),
});

tester.run("import-scope", rules["import-scope"] as never, {
  valid: [
    // Deeper code may import shallower code.
    ["src/app/home/_components/b.tsx", "../../a"],
    ["src/app/home/page.tsx", "./_components/b"],
    ["src/app/home/settings/page.tsx", "../_components/b"],
    ["src/app/home/_components/b.tsx", "./c"],
    ["src/app/page.tsx", "./_components/a"],
    // Anything may import src/lib.
    ["src/app/page.tsx", "../lib/db"],
  ].map(([filename, source]) => ({
    code: `import x from "${source}";`,
    filename: at(filename!),
  })),
  invalid: [
    // Shallower code may not reach into a deeper route, nor a sibling.
    ["src/app/a.tsx", "./home/_components/b", "deeper"],
    ["src/app/_components/a.tsx", "../home/b", "deeper"],
    ["src/app/about/page.tsx", "../home/_components/b", "deeper"],
    ["src/lib/db.ts", "../app/a", "outside"],
  ].map(([filename, source, messageId]) => ({
    code: `import x from "${source}";`,
    filename: at(filename!),
    errors: [{ messageId: messageId! }],
  })),
});

tester.run("absolute-imports", rules["absolute-imports"] as never, {
  valid: [
    `import "~/lib/db";`,
    `import "./style.css";`,
    `import "express";`,
  ].map((source) => ({ code: source, filename: at("src/app/page.tsx") })),
  invalid: [
    {
      code: `import { env } from "../env";`,
      filename: at("src/lib/db.ts"),
      errors: [{ messageId: "parent" }],
    },
  ],
});

tester.run("import-scope with ~/", rules["import-scope"] as never, {
  valid: [
    { code: `import a from "~/app/a";`, filename: at("src/app/home/page.tsx") },
  ],
  invalid: [
    {
      code: `import b from "~/app/home/_components/b";`,
      filename: at("src/app/a.tsx"),
      errors: [{ messageId: "deeper" }],
    },
    {
      code: `import a from "~/app/a";`,
      filename: at("src/lib/db.ts"),
      errors: [{ messageId: "outside" }],
    },
  ],
});
