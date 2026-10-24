import { CodeError, ErrorCode } from "@opentyped/framestack-error";
import { createClient } from "@opentyped/oapi-fetch";
import type { schema } from "openapi/api";

/**
 * The app's API, typed from the generated OpenAPI declarations
 * (src/types/openapi.d.ts). Every call resolves `[resp, err]` and never
 * rejects; `err` is always a CodeError.
 */
export const client = createClient<schema, CodeError>({
  async error(failure) {
    if ("response" in failure) {
      // The server's CodeError body; any other body is Unknown.
      return CodeError.fromJSON(
        await failure.response.json().catch(() => null),
      );
    }

    // The request never got a response: aborted, or the network failed.
    const aborted = (failure.thrown as Error | null)?.name === "AbortError";

    return new CodeError(
      aborted ? ErrorCode.Canceled : ErrorCode.Unavailable,
      { message: aborted ? "request canceled" : "network request failed" },
      { cause: failure.thrown },
    );
  },
});
