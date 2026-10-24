import type { Rule } from "eslint";
import type { Node } from "estree";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Route convention files; the router loads them, nothing imports them. */
export const conventions = new Set([
  "page",
  "layout",
  "middleware",
  "route",
  "routes",
  "loading",
  "error",
]);

/** Split a path into `/`-separated segments, dropping empty ones. */
export function segments(path: string): string[] {
  return path
    .split(sep)
    .join("/")
    .split("/")
    .filter((part) => part && part !== ".");
}

/** A path relative to `base`, or undefined when it lies outside. */
export function inside(base: string, path: string): string | undefined {
  const rel = relative(base, path);

  return rel.startsWith("..") || isAbsolute(rel) ? undefined : rel;
}

/** A file name without its extensions: `models.d.ts` → `models`. */
export function stem(name: string): string {
  return name.split(".")[0]!;
}

/** The app directory of the linted project (`src/app`). */
export function appOf(context: Rule.RuleContext): string {
  return resolve(context.cwd, "src/app");
}

/** Report every relative or `~/` import, re-export, and dynamic import with its resolved path. */
export function onImport(
  context: Rule.RuleContext,
  check: (node: Node, target: string) => void,
): Rule.RuleListener {
  const visit = (node: Node, source: unknown) => {
    if (typeof source !== "string") {
      return;
    }

    if (source.startsWith("~/")) {
      check(node, resolve(context.cwd, "src", source.slice(2)));
    } else if (source.startsWith(".")) {
      check(node, resolve(dirname(context.filename), source));
    }
  };

  return {
    ImportDeclaration: (node) => visit(node.source, node.source.value),
    ExportAllDeclaration: (node) => visit(node.source, node.source.value),
    ExportNamedDeclaration: (node) =>
      node.source && visit(node.source, node.source.value),
    ImportExpression: (node) =>
      node.source.type === "Literal" && visit(node.source, node.source.value),
  };
}
