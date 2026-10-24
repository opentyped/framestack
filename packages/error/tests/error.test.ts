import assert from "node:assert/strict";
import { test } from "node:test";

import { CodeError, ErrorCode } from "../dist/index.js";

test("codes map to HTTP statuses and JSON without the cause", () => {
  const error = new CodeError(
    ErrorCode.NotFound,
    { resource: "todo", message: "todo not found" },
    { cause: new Error("secret") },
  );

  assert.equal(error.status, 404);
  assert.equal(error.message, "todo not found");
  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    name: "CodeError",
    code: ErrorCode.NotFound,
    details: { resource: "todo", message: "todo not found" },
  });
});

test("fromJSON rebuilds the error; any other body is Unknown", () => {
  const sent = CodeError.notfound("todo", { id: 1 });
  const rebuilt = CodeError.fromJSON<{ id: number }>(
    JSON.parse(JSON.stringify(sent)),
  );

  assert.ok(CodeError.is(rebuilt, ErrorCode.NotFound));
  assert.equal(rebuilt.details.id, 1);
  assert.equal(rebuilt.message, "todo not found");
  assert.equal(CodeError.fromJSON("slow down").code, ErrorCode.Unknown);
  assert.equal(CodeError.fromJSON(null).code, ErrorCode.Unknown);
});

test("from passes CodeErrors through and wraps anything else as Unknown", () => {
  const coded = CodeError.invalid("bad title");
  const cause = new Error("boom");
  const wrapped = CodeError.from(cause);

  assert.equal(CodeError.from(coded), coded);
  assert.equal(wrapped.code, ErrorCode.Unknown);
  assert.equal(wrapped.cause, cause);
});
