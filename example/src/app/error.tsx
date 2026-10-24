import type { ErrorProps } from "express/rsc";

/** Shown when a page, loader, or guard fails. */
export default function ErrorPage({ error }: ErrorProps) {
  return (
    <p>
      Something went wrong:{" "}
      {error instanceof Error ? error.message : "request failed"}
    </p>
  );
}
