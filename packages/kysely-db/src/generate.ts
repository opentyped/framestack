import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  generate as run,
  schemaModule,
  type ResolvedDatabase,
  type ResolvedRelation,
} from "@opentyped/odb-db";
import { writeFiles } from "@opentyped/odb-db/write";
import { kysely } from "@opentyped/odb-kysely";
import { models } from "@opentyped/odb-models";

import type { Pool } from "./index.js";
import { tables } from "./tables.js";

export interface GenerateOptions {
  /** Project root; paths below are relative to it. */
  root?: string;
  /** Generated declarations and table info. Default `src/types`. */
  types?: string;
  /** Model files, scaffolded once and then owned by the app. Default `src/models`. */
  models?: string;
}

/** Schemas that are the database's default and need no prefix in model paths. */
const defaults = new Set(["public", "main"]);

/**
 * Read the database behind `pool` and write `models.d.ts`, `kysely.d.ts`, and
 * `tables.ts`, then scaffold a model file for every table that has none.
 * Returns the model files it created.
 */
export async function generate(pool: Pool, options: GenerateOptions = {}) {
  const root = resolve(options.root ?? ".");
  const types = options.types ?? "src/types";
  const modelsDir = options.models ?? "src/models";
  let resolved: ResolvedDatabase | undefined;

  const result = await run({
    source: pool.driver.source(pool.handle),
    generators: [
      // The model files re-export these with @schema, so they are the OpenAPI schemas.
      models({
        files: { declarations: join(types, "models.d.ts") },
        schema: false,
      }),
      kysely({ files: { declarations: join(types, "kysely.d.ts") } }),
      tables({ file: join(types, "tables.ts") }),
      {
        // Captures the resolved database for scaffolding; writes nothing.
        name: "framestack:capture",
        files: {},
        generate(database) {
          resolved = database;
          return { files: {} };
        },
      },
    ],
  });

  await writeFiles(result, root);

  const created: string[] = [];

  for (const relation of resolved!.relations) {
    const file = join(
      modelsDir,
      ...(defaults.has(relation.schema) ? [] : [relation.schema]),
      relation.name + ".ts",
    );

    if (!existsSync(resolve(root, file))) {
      await mkdir(dirname(resolve(root, file)), { recursive: true });
      await writeFile(resolve(root, file), scaffold(relation, resolved!));
      created.push(file);
    }
  }

  return created;
}

/** The starting content of a model file: its types, table info, and one query. */
function scaffold(relation: ResolvedRelation, database: ResolvedDatabase) {
  const name = relation.typeName;
  const schema = schemaModule(database, relation.schema);
  // The default schema's types are re-exported by the root modules.
  const models = schema === "public" ? "odb" : `odb/${schema}`;
  const kysely = schema === "public" ? "odb/kysely" : `odb/kysely/${schema}`;
  const id = database.identifiers.find(
    (identifier) =>
      identifier.schema === relation.schema && identifier.name === name + "Id",
  );
  const key = JSON.stringify(relation.key);
  const primary = relation.columns.find((column) => column.primaryKey);
  const order = primary ? `.orderBy(${JSON.stringify(primary.name)})` : "";
  // The query object is named after the table: auth_user → authuserdb.
  const db = relation.name.toLowerCase().replace(/[^a-z0-9]/g, "") + "db";
  const access = /^[A-Za-z_$][\w$]*$/.test(relation.key)
    ? `.${relation.key}`
    : `[${key}]`;
  // Each type is re-exported under its own name, documented as an OpenAPI schema.
  const types = [
    ...(id ? [`${id.name} = model.${id.name}`] : []),
    `${name} = model.${name}`,
  ]
    .map((type) => `/** @schema */\nexport type ${type};`)
    // Kysely's shapes are built from ColumnType and mapped types, which oapi cannot turn into JSON schemas.
    .concat(
      [`${name}Table`, `New${name}`, `${name}Update`].map(
        (type) => `export type ${type} = row.${type};`,
      ),
    )
    .join("\n\n");

  // Sorted as lint expects: within one module the namespace import comes first.
  const row = `import type * as row from "${kysely}";`;
  // Commented out with the example query below; uncomment them together.
  const conn = `// import type { Conn } from "odb/kysely";`;
  const imports =
    kysely === "odb/kysely" ? `${row}\n${conn}` : `${conn}\n${row}`;

  return `// import { query, raw, sql } from "@opentyped/framestack-kysely-db";
import type * as model from "${models}";
${imports}

import { tables } from "~/types/tables";

${types}

/** Columns, keys, and constraints of ${relation.key}. */
export const table = tables${access};

// Created once by framestack; this file is yours.
export const ${db} = {
  // /** Every ${relation.key} row. */
  // async findAll(conn: Conn) {
  //   return conn.selectFrom(${key}).selectAll()${order}.execute();
  // },
};

export default ${db};
`;
}
